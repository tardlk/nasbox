// SPDX-License-Identifier: GPL-3.0-only
// Compare metadata from the same captured JARs; live response differences are observations.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarizeMatrix } from '../container/jar-matrix-probe.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const key = row => row.api + '\0' + row.extSha256;
const uncertain = failure => ['timeout', 'artifact-timeout', 'environment', 'input', 'network'].includes(failure?.category);
function loadState(row) {
  if (row?.load?.loaded === true) return 'loaded';
  if (row?.load?.loaded === false && !uncertain(row.load.error)) return 'failed';
  if (!row?.load && row?.error?.stage === 'load' && !uncertain(row.error)) return 'failed';
  return 'unknown';
}
const initState = row => row?.init?.ok === true ? 'ready' : row?.init?.ok === false && !uncertain(row.init.error) ? 'failed' : 'unknown';
const contentState = row => !row ? 'not-tested' : row.ok ? row.hasContent ? 'content' : 'empty' : uncertain(row.error) ? 'unknown' : 'failed';
const safeLabel = value => String(value).length > 160 || /(?:https?:|:\/\/|[?=&\r\n]|bearer\s|token[:\s])/i.test(String(value)) ? 'sha256:' + hash(String(value)) : String(value);
const observationFields = ['attemptedApis', 'readyApis', 'homes', 'homesWithContent', 'categories', 'categoriesWithContent', 'details', 'detailsWithContent', 'budgetSkipped', 'allUnattemptedVariants', 'unattemptedLoadFailure'];
const safeObservations = value => value ? Object.fromEntries(observationFields.filter(field => Number.isSafeInteger(value[field]) && value[field] >= 0).map(field => [field, value[field]])) : null;
const safeReason = value => ['artifact-budget', 'load-failure', 'variant-budget', 'artifact-failure'].includes(value) ? value : 'unknown';
const labelCounts = values => values.reduce((result, value) => (result[value] = (result[value] || 0) + 1, result), {});
const transition = (before, after, positive, negative) => before === positive && after === negative ? 'candidate-regression' : before === negative && after === positive ? 'improved' : before === 'unknown' || after === 'unknown' || before === 'not-tested' || after === 'not-tested' ? 'coverage-or-unknown' : before === after ? 'same' : 'changed';
function sourceVariants(artifact) {
  const map = new Map();
  for (const source of artifact.sites) {
    const executionExtSha256 = hash(typeof source.ext === 'string' ? source.ext : JSON.stringify(source.ext ?? ''));
    map.set(safeLabel(source.api) + '\0' + executionExtSha256, { api: safeLabel(source.api), executionExtSha256, captureExtSha256: source.extSha256 });
  }
  return map;
}
function indexPass(pass, manifestIds) {
  const map = new Map();
  for (const row of pass.artifacts) {
    if (!manifestIds.has(row.id) || map.has(row.id)) throw new Error('Unknown or duplicate matrix artifact');
    if (row.input && row.input.sha256 !== row.id) throw new Error('Execution artifact input checksum differs');
    if ((row.load?.loaded === true || row.sites?.length) && row.input?.sha256 !== row.id) throw new Error('Executed artifact lacks verified input checksum');
    const variants = new Set();
    for (const source of row.sites || []) {
      if (typeof source.api !== 'string' || !/^[a-f0-9]{64}$/.test(source.extSha256)) throw new Error('Malformed execution variant identity');
      if (variants.has(key(source))) throw new Error('Duplicate execution variant identity');
      variants.add(key(source));
    }
    const unattempted = new Set();
    for (const source of row.unattempted || []) {
      if (typeof source.api !== 'string' || !/^[a-f0-9]{64}$/.test(source.extSha256)) throw new Error('Malformed unattempted variant identity');
      if (unattempted.has(key(source)) || variants.has(key(source))) throw new Error('Conflicting unattempted variant identity');
      unattempted.add(key(source));
    }
    map.set(row.id, row);
  }
  return map;
}
export function compareJarMatrices(manifest, oldPass, newPass) {
  if (!Array.isArray(manifest?.artifacts) || !Array.isArray(oldPass?.artifacts) || !Array.isArray(newPass?.artifacts)) throw new Error('Expected captured manifest and matrix reports');
  const ids = new Set(manifest.artifacts.map(row => row.sha256));
  if (ids.size !== manifest.artifacts.length || manifest.artifacts.some(row => row.id !== row.sha256)) throw new Error('Manifest identity must be unique captured SHA256');
  const oldRows = indexPass(oldPass, ids), newRows = indexPass(newPass, ids);
  const artifacts = manifest.artifacts.map(input => {
    const before = oldRows.get(input.id), after = newRows.get(input.id);
    const expected = sourceVariants(input), a = new Map((before?.sites || []).map(row => [key(row), row])), b = new Map((after?.sites || []).map(row => [key(row), row]));
    for (const id of [...a.keys(), ...b.keys(), ...(before?.unattempted || []).map(key), ...(after?.unattempted || []).map(key)]) if (!expected.has(id)) throw new Error('Execution variant not present in captured artifact');
    const pendingOld = new Map((before?.unattempted || []).map(row => [key(row), safeReason(row.reason)]));
    const pendingNew = new Map((after?.unattempted || []).map(row => [key(row), safeReason(row.reason)]));
    const variants = [...expected].map(([identity, variant]) => {
      const old = a.get(identity), next = b.get(identity);
      const oldInit = initState(old), newInit = initState(next);
      const oldHome = contentState(old?.homeContent), newHome = contentState(next?.homeContent);
      const responseHashes = old?.homeContent?.ok && next?.homeContent?.ok ? {
        fullBytesEqual: old.homeContent.sha256 === next.homeContent.sha256,
        semanticEqual: old.homeContent.semanticSha256 === next.homeContent.semanticSha256,
        ...(old.homeContent.classSha256 && next.homeContent.classSha256 ? { classesEqual: old.homeContent.classSha256 === next.homeContent.classSha256 } : {}),
        ...(old.homeContent.filtersSha256 && next.homeContent.filtersSha256 ? { filtersEqual: old.homeContent.filtersSha256 === next.homeContent.filtersSha256 } : {}),
      } : undefined;
      return { ...variant, old: { init: oldInit, home: oldHome, ...(pendingOld.has(identity) ? { unattemptedReason: pendingOld.get(identity) } : {}) },
        new: { init: newInit, home: newHome, ...(pendingNew.has(identity) ? { unattemptedReason: pendingNew.get(identity) } : {}) },
        initTransition: transition(oldInit, newInit, 'ready', 'failed'),
        homeTransition: transition(oldHome, newHome, 'content', 'failed'),
        ...(responseHashes ? { liveHomeComparison: responseHashes } : {}) };
    });
    const oldLoad = loadState(before), newLoad = loadState(after);
    return { sha256: input.sha256, bytes: input.bytes, referencedRoles: input.roles,
      catalogNames: [...new Set((input.references || []).map(row => safeLabel(row.publicName)))],
      validZip: input.inspection?.ok === true, oldLoad, newLoad, loadTransition: transition(oldLoad, newLoad, 'loaded', 'failed'),
      variants, observations: { old: safeObservations(before?.observations), new: safeObservations(after?.observations) },
      ...(before ? {} : { oldMissing: true }), ...(after ? {} : { newMissing: true }) };
  });
  const all = artifacts.flatMap(row => row.variants);
  return { schemaVersion: 1, generatedAt: new Date().toISOString(),
    scope: 'Same captured JAR/config/ext inputs; default Android initialization policy; independent NAS JVM/DEX/ARM execution. Remote business response bodies were live and are not byte-pinned. Candidate regressions need diagnosis; budget, network and environment unknowns are not failures.',
    identityNote: 'captureExtSha256 hashes canonical JSON including string quoting; executionExtSha256 hashes the raw string or JSON object passed to the worker. Pairing uses JAR SHA256 + API + executionExtSha256.',
    summary: { capturedArtifacts: manifest.artifacts.length, structurallyValidArtifacts: manifest.artifacts.filter(row => row.inspection?.ok === true).length, old: summarizeMatrix(oldPass.artifacts), new: summarizeMatrix(newPass.artifacts),
      evidenceByArtifact: Object.fromEntries([['old', oldPass], ['new', newPass]].map(([name, pass]) => [name, { withReadySpider: pass.artifacts.filter(row => row.sites?.some(site => site.init?.ok)).length, withNonemptyHome: pass.artifacts.filter(row => row.sites?.some(site => site.homeContent?.ok && site.homeContent.hasContent)).length, withNonemptyCategory: pass.artifacts.filter(row => row.sites?.some(site => site.categoryContent?.ok && site.categoryContent.hasContent)).length, withNonemptyDetail: pass.artifacts.filter(row => row.sites?.some(site => site.detailContent?.ok && site.detailContent.hasContent)).length }])),
      artifactLoads: labelCounts(artifacts.map(row => row.oldLoad + ' -> ' + row.newLoad)),
      initTransitions: labelCounts(all.map(row => row.old.init + ' -> ' + row.new.init)),
      homeTransitions: labelCounts(all.map(row => row.old.home + ' -> ' + row.new.home)),
      loadImprovements: artifacts.filter(row => row.loadTransition === 'improved').map(row => row.sha256),
      loadCandidateRegressions: artifacts.filter(row => row.loadTransition === 'candidate-regression').map(row => row.sha256),
      initImprovements: all.filter(row => row.initTransition === 'improved').length,
      initCandidateRegressions: all.filter(row => row.initTransition === 'candidate-regression').length,
      liveHomeSemanticDifferences: all.filter(row => row.liveHomeComparison?.semanticEqual === false).length }, artifacts };
}
export function comparisonMarkdown(report) {
  const s = report.summary;
  return '# JAR 修复后同输入全量对照\n\n' +
    `采集 ${report.capture?.completedAt || ''}，${s.capturedArtifacts} 份同字节制品。旧、新镜像均使用 Android 默认初始化策略。\n\n` +
    '| 观测 | 旧版 | 修复版 |\n| --- | ---: | ---: |\n' +
    [['成功加载制品', 'loaded'], ['实际初始化入口', 'attemptedApis'], ['取得 Spider 入口', 'readyApis'], ['非空首页', 'homesWithContent'], ['非空分类', 'categoriesWithContent'], ['非空详情', 'detailsWithContent'], ['未初始化变体', 'allUnattemptedVariants']].map(([name, field]) => `| ${name} | ${s.old[field]} | ${s.new[field]} |`).join('\n') + '\n\n' +
    `取得至少一个 Spider 的制品为 ${s.evidenceByArtifact.old.withReadySpider} → ${s.evidenceByArtifact.new.withReadySpider} 份，有非空首页的制品为 ${s.evidenceByArtifact.old.withNonemptyHome} → ${s.evidenceByArtifact.new.withNonemptyHome} 份。\n\n` +
    `按 JAR SHA、API、实际 ext SHA 配对，新增明确加载成功 ${s.loadImprovements.length} 份；加载候选退步 ${s.loadCandidateRegressions.length} 份；初始化失败转成功 ${s.initImprovements} 个，成功转失败候选 ${s.initCandidateRegressions} 个。超时、网络、预算不足、未测试和环境问题单独记录。\n\n` +
    '同一 SHA 若既有主 JAR 又有站点 JAR 引用，本轮统一选择主 JAR 角色；没有穷举所有角色。首页、分类与详情调用数量受每份制品一次首页和有界时间预算限制。远端业务响应没有固定；完整响应哈希差异仅为观测，不能自动判为兼容性退步。此报告不等于 Android/ART 一致性验收。\n\n' +
    '| JAR SHA 前12位 | 目录 | 加载旧→新 | Spider旧→新 | 非空首页旧→新 |\n| --- | --- | --- | ---: | ---: |\n' +
    report.artifacts.map(row => `| ${row.sha256.slice(0, 12)} | ${row.catalogNames.join('、').replaceAll('|', '／')} | ${row.oldLoad} → ${row.newLoad} | ${row.observations.old?.readyApis || 0} → ${row.observations.new?.readyApis || 0} | ${row.observations.old?.homesWithContent || 0} → ${row.observations.new?.homesWithContent || 0} |`).join('\n') + '\n';
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), value = name => args[args.indexOf(name) + 1];
  if (!['--manifest', '--old', '--new', '--output'].every(name => args.includes(name))) throw new Error('Usage: --manifest input.json --old report.json --new report.json --output comparison.json [--markdown comparison.md]');
  const [manifest, before, after] = await Promise.all(['--manifest', '--old', '--new'].map(async name => JSON.parse(await readFile(value(name), 'utf8'))));
  const report = compareJarMatrices(manifest, before, after);
  await writeFile(value('--output'), JSON.stringify(report, null, 2) + '\n');
  if (args.includes('--markdown')) await writeFile(value('--markdown'), comparisonMarkdown(report));
}
