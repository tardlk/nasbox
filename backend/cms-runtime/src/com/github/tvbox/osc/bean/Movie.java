// SPDX-License-Identifier: GPL-3.0-only
// Derived from pinned TVBoxOS; XStream XML annotations removed. JSON/mapping bodies unchanged.
package com.github.tvbox.osc.bean;


import java.io.Serializable;
import java.util.List;

/**
 * @author pj567
 * @date :2020/12/18
 * @description:
 */
public class Movie implements Serializable {
    public int page;
    public int pagecount;//总页数
    public int pagesize;
    public int recordcount;//总条数
    public List<Video> videoList;

    public static class Video implements Serializable {
        public String last;
        public String id;
        public int tid;
        public String name;
        public String type;
        /*@XStreamAlias("dt")//视频分类 zuidam3u8,zuidall
        public String dt;*/
        public String pic;
        public String lang;
        public String area;
        public int year;
        public String state;
        public String note;
        public String actor;
        public String director;
        public UrlBean urlBean;
        public String des;// <![CDATA[权来]
        public String sourceKey;
        public String tag;
        public String action;

        public static class UrlBean implements Serializable {
            public List<UrlInfo> infoList;

            public static class UrlInfo implements Serializable {
                public String flag;//zuidam3u8,zuidall(MP4)
                // <![CDATA[第01集$http://video.zuidajiexi.com/20170825/txpkmcnK/index.m3u8#第02集$http://video.zuidajiexi.com/20170825/YOApVCHc/index.m3u8]]
                public String urls;
                public List<InfoBean> beanList;

                public static class InfoBean implements Serializable {
                    public String name;
                    public String url;

                    public InfoBean(String name, String url) {
                        this.name = name;
                        this.url = url;
                    }

                }
            }

        }

    }

}
