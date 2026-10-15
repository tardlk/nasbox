// SPDX-License-Identifier: GPL-3.0-only
// Aggregate captured catalog metadata without retaining subscriptions or source bodies.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const sha = value => createHash('sha256').update(value).digest('hex');
const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
const label = value => {
  const text = String(value ?? '');
  return /(?:https?:|:\/\/|[?=&\r\n]|bearer\s|token[:\s])/i.test(text) || text.length > 180 ? 'sha256:' + sha(text) : text;
};
const counts = values => Object.fromEntries([...values.reduce((map, value) => map.set(value, (map.get(value) || 0) + 1), new Map())].sort((a, b) => b[1] - a[1]));
const pick = (value, keys) => Object.fromEntries(keys.filter(key => value?.[key] !== undefined).map(key => [key, value[key]]));
function executionArtifact(value) {
  if (!value || typeof value.id !== 'string' || !Array.isArray(value.sites) || !value.cleanup || !value.observations
      || ['jarPath', 'signature', 'references', 'ext'].some(key => key in value)) throw new Error('Expected metadata execution artifact, not captured input');
  const result = pick(value, ['id', 'role', 'chosenRole', 'referencedRoles', 'limits', 'selected', 'sourceCount', 'cleanup', 'input',
    'nativeBefore', 'load', 'nativeLoaded', 'nativeAfter', 'uniqueApis', 'uniqueVariants', 'duplicateSources', 'skippedNonCspSources',
    'variantBudgetSkipped', 'unattemptedApis', 'budgetSkipped', 'allUnattemptedVariants', 'unattemptedLoadFailure',
    'diagnostics', 'milliseconds', 'observations', 'error', 'partialProgress', 'unattemptedVariants', 'exit']);
  result.sites = value.sites.map(site => {
    if (!site || ['ext', 'jar', 'jarPath', 'signature'].some(key => key in site)) throw new Error('Execution site must not include captured source bodies');
    return pick(site, ['sourceKey', 'api', 'extSha256', 'init', 'homeContent', 'categoryContent', 'detailContent']);
  });
  result.unattempted = (value.unattempted || []).map(site => pick(site, ['sourceKey', 'api', 'extSha256', 'reason']));
  return result;
}

export async function catalogReport(directory, passes = []) {
  const root = resolve(directory), inventory = await readJson(resolve(root, 'inventory.json'));
  const artifacts = await readJson(resolve(root, 'artifact-inventory.json'));
  const manifest = await readJson(resolve(root, 'input-manifest.json'));
  const byId = new Map(manifest.artifacts.map(artifact => [artifact.id, artifact]));
  const files = ['index.html', 'site-config.json', 'list.txt', 'inventory.json', 'artifact-inventory.json', 'input-manifest.json'];
  const pins = await Promise.all(files.map(async file => ({ file, sha256: sha(await readFile(resolve(root, file))) })));
  const rows = artifacts.artifacts.map(artifact => {
    const sites = byId.get(artifact.id)?.sites || [];
    const inspection = artifact.inspection;
    return {
      sha256: artifact.sha256, bytes: artifact.bytes, role: artifact.role, referencedRoles: artifact.roles,
      catalogNames: [...new Set(artifact.references.map(reference => label(reference.publicName)))],
      partialSubscriptionReferences: artifact.references.filter(reference => reference.partial).length,
      sourceReferences: artifact.sourceReferences, sourceVariants: artifact.sourceVariants,
      uniqueApis: new Set(sites.map(site => site.api)).size,
      helperOnly: sites.length === 0,
      inspection: {
        ok: inspection.ok, ...(inspection.ok ? {
          entries: inspection.entries, expandedBytes: inspection.expandedBytes,
          classFiles: inspection.classFiles, dexClasses: inspection.dexClasses, dex: inspection.dex,
          native: inspection.native, protectedPayloads: inspection.protectedPayloads,
        } : { errorCode: inspection.error?.code }),
      },
    };
  });
  const processedPasses = [];
  for (const pass of passes) {
    const raw = await readJson(pass.path);
    if (!raw.host || !raw.observations || typeof raw.manifestSha256 !== 'string' || !raw.cleanup || !Array.isArray(raw.artifacts)) throw new Error('Expected matrix execution report, not input manifest');
    const result = raw.artifacts.map(executionArtifact);
    const seen = new Set();
    for (const artifact of result) {
      if (!byId.has(artifact.id) || seen.has(artifact.id)) throw new Error('Unknown or duplicate execution artifact identity');
      if (artifact.input && artifact.input.sha256 !== artifact.id) throw new Error('Execution input hash differs from captured identity');
      seen.add(artifact.id);
    }
    processedPasses.push({
      name: label(pass.name), reportSha256: sha(await readFile(pass.path)),
      date: raw.date, host: raw.host, manifestSha256: raw.manifestSha256,
      observations: raw.observations, milliseconds: raw.milliseconds, cleanup: raw.cleanup,
      runnerSha256: pass.runnerSha256,
      artifacts: result,
    });
  }
  const resultsById = new Map();
  for (const pass of processedPasses) for (const result of pass.artifacts) {
    const rows = resultsById.get(result.id) || []; rows.push({ pass: pass.name, result }); resultsById.set(result.id, rows);
  }
  for (const row of rows) {
    const results = resultsById.get(row.sha256) || [];
    const attempted = new Set(), ready = new Set(), content = { homeContent: new Set(), categoryContent: new Set(), detailContent: new Set() };
    for (const { result } of results) for (const site of result.sites) {
      const key = site.api + '\0' + site.extSha256;
      attempted.add(key);
      if (site.init?.ok) ready.add(key);
      for (const method of Object.keys(content)) if (site[method]?.ok && site[method].hasContent) content[method].add(key);
    }
    // Retain all attempts; this summary distinguishes positive evidence from unresolved budgets.
    row.execution = {
      attempts: results.length,
      passes: results.map(({ pass }) => pass),
      initializedVariantsAttempted: attempted.size, readyVariants: ready.size,
      variantsNotInitialized: Math.max(0, row.sourceVariants - attempted.size),
      homeVariantsWithContent: content.homeContent.size,
      categoryVariantsWithContent: content.categoryContent.size,
      detailVariantsWithContent: content.detailContent.size,
      loadedAtLeastOnce: results.some(({ result }) => result.load?.loaded === true),
      readyAtLeastOnce: results.some(({ result }) => result.observations?.readyApis > 0),
      homeWithContentAtLeastOnce: results.some(({ result }) => result.observations?.homesWithContent > 0),
      categoryWithContentAtLeastOnce: results.some(({ result }) => result.observations?.categoriesWithContent > 0),
      detailWithContentAtLeastOnce: results.some(({ result }) => result.observations?.detailsWithContent > 0),
      failures: [...new Set(results.flatMap(({ result }) => [result.error?.category, result.load?.error?.category].filter(Boolean)))],
    };
  }
  const successful = artifacts.retrievals.filter(row => row.ok);
  const failed = artifacts.retrievals.filter(row => !row.ok);
  return {
    schemaVersion: 1, date: new Date().toISOString(),
    scope: 'Public catalogue capture, byte-deduplicated JAR static inventory and bounded independent NAS execution; no Android/ART equivalence or complete source compatibility rate',
    catalog: {
      publicOrigin: 'https://0.12yue.de5.net/', inputHashes: pins,
      entries: inventory.entries.length, accepted: inventory.entries.filter(row => row.parseSuccess).length,
      partial: inventory.entries.filter(row => row.partial).length,
      acceptedSourceReferences: inventory.summary.sourceReferences,
      partialSourceReferences: inventory.entries.filter(row => row.partial).reduce((sum, row) => sum + (row.partialSourceCount || 0), 0),
      customCatalog: { accepted: !!inventory.customCatalog?.ok, candidates: inventory.customCatalog?.candidates || 0 },
      entryResults: inventory.entries.map(row => ({
        id: row.id, publicName: label(row.publicName), accepted: row.parseSuccess,
        partial: !!row.partial, sourceCount: row.sourceCount || 0, partialSourceCount: row.partialSourceCount || 0,
        configSha256: row.configSha256 || row.partialConfigSha256,
        partialErrorType: row.partialErrorType,
      })),
    },
    retrieval: {
      requestedSignatures: artifacts.summary.requestedSignatures, successful: successful.length, failed: failed.length,
      failureCodes: counts(failed.map(row => row.error?.code || 'Error')),
      advertisedMd5: { matched: successful.filter(row => row.md5Matches === true).length, mismatched: successful.filter(row => row.md5Matches === false).length, unavailable: successful.filter(row => row.md5Matches == null).length },
      retrievals: artifacts.retrievals.map(row => ({
        signatureSha256: sha(row.signature), role: row.role, ok: row.ok, sha256: row.sha256,
        bytes: row.bytes, md5Matches: row.md5Matches,
        ...(row.error ? { errorCode: row.error.code } : {}),
        sourceReferences: row.siteReferences,
        catalogNames: [...new Set(row.references.map(reference => label(reference.publicName)))],
        kinds: counts(row.references.map(reference => reference.kind)),
      })),
    },
    inventory: {
      artifacts: rows.length, validZip: rows.filter(row => row.inspection.ok).length,
      native: rows.filter(row => row.inspection.native?.length).length,
      protectedPayloads: rows.filter(row => row.inspection.protectedPayloads?.length).length,
      helperOnly: rows.filter(row => row.helperOnly).length,
      sourceReferences: artifacts.summary.sourceReferences, sourceVariants: artifacts.summary.sourceVariants,
    },
    execution: {
      uniqueArtifactsAttempted: resultsById.size,
      initializedVariantsAttempted: rows.reduce((sum, row) => sum + row.execution.initializedVariantsAttempted, 0),
      readyVariants: rows.reduce((sum, row) => sum + row.execution.readyVariants, 0),
      variantsNotInitialized: rows.reduce((sum, row) => sum + row.execution.variantsNotInitialized, 0),
      homeVariantsWithContent: rows.reduce((sum, row) => sum + row.execution.homeVariantsWithContent, 0),
      categoryVariantsWithContent: rows.reduce((sum, row) => sum + row.execution.categoryVariantsWithContent, 0),
      detailVariantsWithContent: rows.reduce((sum, row) => sum + row.execution.detailVariantsWithContent, 0),
      loadedAtLeastOnce: rows.filter(row => row.execution.loadedAtLeastOnce).length,
      readyAtLeastOnce: rows.filter(row => row.execution.readyAtLeastOnce).length,
      homeWithContentAtLeastOnce: rows.filter(row => row.execution.homeWithContentAtLeastOnce).length,
      categoryWithContentAtLeastOnce: rows.filter(row => row.execution.categoryWithContentAtLeastOnce).length,
      detailWithContentAtLeastOnce: rows.filter(row => row.execution.detailWithContentAtLeastOnce).length,
      allAcquiredArtifactsAttempted: rows.every(row => row.execution.attempts > 0),
    },
    artifacts: rows, passes: processedPasses,
    limits: [
      'Catalogue source references, SHA-deduplicated artifacts, APIs and ext variants have different denominators.',
      'A successful retrieval may contain HTML/SVG or advertise a mismatched MD5; neither is a passing engine test.',
      'Loaded, Spider ready, valid JSON and nonempty class/list responses are reported separately.',
      'Every captured artifact is isolated; mixed main/site reference roles are not all tested merely because its SHA ran once.',
      'Budget skips, load timeouts and network failures remain unresolved, not permanent incompatibility findings.',
      'Initial scanning samples one ext per API and a bounded set of home/category/detail calls; untested variants remain open.',
      'JS/Python helper artifacts may have no standalone CSP sites; those script runtimes and dynamic helper use are outside this matrix.',
      'Live provider responses are not replayed; no Mac/NAS same-input execution comparison or Android/ART certification is implied.',
      'Raw subscription/config/JAR and response content are temporary inputs and are removed after verification.',
    ],
  };
}

export function renderCatalogReport(report) {
  const { catalog: c, retrieval: r, inventory: i, execution: e } = report;
  const cell = value => String(value ?? '').replaceAll('|', '\\|').replace(/[\r\n]+/g, ' ');
  const lines = [
    '# 公开订阅目录与 JAR 兼容性测试', '',
    `记录日期：${report.date.slice(0, 10)}。目录 ${c.entries} 条，完整导入 ${c.accepted} 条，另有 ${c.partial} 条保留部分解析状态。`, '',
    `完整导入包含 ${c.acceptedSourceReferences} 个源引用；部分配置另有 ${c.partialSourceReferences} 个。JAR 获取 ${r.successful}/${r.requestedSignatures} 项成功，按下载后解码内容去重为 ${i.artifacts} 份，其中 ${i.validZip} 份是有效 ZIP。其余内容、HTTP 获取失败和引擎执行失败分开记录。`, '',
    `已尝试 ${e.uniqueArtifactsAttempted} 份制品，${e.loadedAtLeastOnce} 份取得明确加载成功证据，${e.readyAtLeastOnce} 份取得至少一个 Spider。${e.homeWithContentAtLeastOnce} 份有非空首页，${e.categoryWithContentAtLeastOnce} 份有非空分类，${e.detailWithContentAtLeastOnce} 份有非空详情。`, '',
    `捕获的 ${i.sourceVariants} 个 API/ext 变体中，实际初始化尝试 ${e.initializedVariantsAttempted} 个，成功 ${e.readyVariants} 个，${e.variantsNotInitialized} 个尚未初始化。每份制品仅抽取有限首页、分类和详情，数字不能解释为所有源的兼容率。`, '',
    '第一轮测试器的站点 JAR 首次调用包括 DEX 转换，却使用了较短的初始化预算；补测已将首次调用改用加载预算。两轮记录及脚本哈希分别保留，初轮超时不作为不兼容定论。', '',
    `有效 ZIP 中 ${i.native} 份含原生库，${i.protectedPayloads} 份含 guard 载荷。${i.helperOnly} 份只有 JS/Python 辅助库引用，不能用独立 CSP 首页判断其脚本能力。`, '',
    `成功获取记录中，声明 MD5 匹配 ${r.advertisedMd5.matched} 项、不匹配 ${r.advertisedMd5.mismatched} 项、未声明或不可得 ${r.advertisedMd5.unavailable} 项。本轮保留 Android 默认获取语义；SHA-256 固定实际输入，不代表全部发布方完整性通过。`, '',
    '下表按同一 JAR 的多轮正面证据合并；“未证实”包含加载失败和超时等未决情况，具体阶段在 JSON 报告中。未混用不同 JAR 来补某个源缺少的类。', '',
    '| JAR SHA 前12位 | 关联订阅 | ZIP | 加载 | 成功 Spider 变体 | 非空首页/分类/详情 | 尚未初始化变体 |',
    '| --- | --- | --- | --- | ---: | ---: | ---: |',
  ];
  for (const a of report.artifacts) {
    const x = a.execution, names = a.catalogNames.join('、');
    lines.push(`| ${a.sha256.slice(0, 12)} | ${cell(names.length > 75 ? names.slice(0, 75) + '…' : names)} | ${a.inspection.ok ? '有效' : '非 JAR 内容'} | ${x.loadedAtLeastOnce ? '成功' : '未证实'} | ${x.readyVariants} | ${x.homeVariantsWithContent}/${x.categoryVariantsWithContent}/${x.detailVariantsWithContent} | ${x.variantsNotInitialized} |`);
  }
  lines.push('', '尚待处理的范围包括更多 ext 变体、混合 main/site 加载角色、动态辅助 JAR、多个原生 JAR 在正式会话中的独立 worker，以及 Android/ART 同输入对照。直播、播放与解码不在这批测试中。', '');
  return lines.join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [directory, output, ...inputs] = process.argv.slice(2);
  if (!directory || !output) throw new Error('Usage: node catalog-report.mjs CAPTURE_DIR OUTPUT [NAME[@RUNNER_SHA256]=REPORT ...]');
  const passes = inputs.map(input => {
    const index = input.indexOf('='); if (index < 1) throw new Error('Expected NAME[@RUNNER_SHA256]=REPORT');
    const [name, runnerSha256] = input.slice(0, index).split('@');
    if (runnerSha256 && !/^[a-f0-9]{64}$/.test(runnerSha256)) throw new Error('Invalid runner SHA256');
    return { name, runnerSha256, path: input.slice(index + 1) };
  });
  const report = await catalogReport(directory, passes);
  await mkdir(dirname(resolve(output)), { recursive: true });
  await writeFile(resolve(output), JSON.stringify(report, null, 2) + '\n');
  if (/\.json$/i.test(output)) await writeFile(resolve(output.replace(/\.json$/i, '.md')), renderCatalogReport(report));
  console.log(JSON.stringify({ catalog: report.catalog.accepted, inventory: report.inventory, execution: report.execution }));
}
