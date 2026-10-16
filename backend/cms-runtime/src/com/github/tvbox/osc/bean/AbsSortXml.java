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
public class AbsSortXml implements Serializable {
    public String sourceKey;

    public MovieSort classes;

    public Movie list;

    public List<Movie.Video> videoList;
}
