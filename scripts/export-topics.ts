#!/usr/bin/env tsx
/**
 * scripts/export-topics.ts
 *
 * 读取 config/topics.yaml 中 26 个关键词类目 →
 *   - 按每条笔记 topics[] 或 geoHint (cityName/attractionName) 做命中匹配
 *   - 生成 coverage.txt (命中计数 + 覆盖率百分比)
 *   - 生成 TOPICS_RANKING.md (每类目按 点赞 + 2 * 收藏 权重排序)
 */

import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { readNdjson } from "../src/lib/storage.js";
import type { XhsNote } from "../src/schema/note.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

type TopicDef = {
  type: string;
  name: string;
  aliases: string[];
};

export function loadTopics(root: string = ROOT): TopicDef[] {
  const p = path.join(root, "config", "topics.yaml");
  const raw = fs.readFileSync(p, "utf8");
  const obj = parseYaml(raw) as { categories?: TopicDef[] };
  return (obj?.categories ?? []).filter(
    (c): c is TopicDef => !!c && typeof c.name === "string" && Array.isArray(c.aliases)
  );
}

export type MatchResult = {
  topic: TopicDef;
  hitNoteIds: string[];
};

export function matchTopics(
  notes: XhsNote[],
  topics: TopicDef[]
): MatchResult[] {
  return topics.map((topic) => {
    const keywords = [topic.name, ...(topic.aliases ?? [])].map((s) => s.trim()).filter(Boolean);
    const hitNoteIds: string[] = [];
    for (const n of notes) {
      if (n.removeRequested !== false) continue;
      // 拼接需要搜索的全文
      const hay = [
        n.topics.join(" "),
        n.geoHint.cityName ?? "",
        n.geoHint.attractionName ?? "",
        n.title ?? "",
        n.bodyPlainText ?? "",
      ].join("  \n  ");
      if (keywords.some((k) => k && hay.includes(k))) {
        hitNoteIds.push(n.noteId);
      }
    }
    return { topic, hitNoteIds };
  });
}

/** 计算权重分 = likeCount + 2*collectCount */
export function score(note: XhsNote): number {
  return (note.likeCount ?? 0) + 2 * (note.collectCount ?? 0);
}

export type CoverageOutput = {
  totalCategories: number;
  covered: number;
  coveragePercent: string; // 如 "100%"
  rows: Array<{
    index: number;
    type: string;
    name: string;
    hitCount: number;
    noteIds: string[];
    covered: boolean;
  }>;
};

export function computeCoverage(root: string = ROOT): {
  coverage: CoverageOutput;
  notes: XhsNote[];
  topics: TopicDef[];
  matches: MatchResult[];
} {
  const topics = loadTopics(root);
  const ndjsonMap = readNdjson(root);
  const notes: XhsNote[] = [...ndjsonMap.values()]
    .map((v) => v.note)
    .filter((n): n is XhsNote => !!n);
  const matches = matchTopics(notes, topics);
  let covered = 0;
  const rows: CoverageOutput["rows"] = matches.map((m, i) => {
    const isCovered = m.hitNoteIds.length >= 1;
    if (isCovered) covered++;
    return {
      index: i + 1,
      type: m.topic.type,
      name: m.topic.name,
      hitCount: m.hitNoteIds.length,
      noteIds: m.hitNoteIds,
      covered: isCovered,
    };
  });
  return {
    coverage: {
      totalCategories: topics.length,
      covered,
      coveragePercent: topics.length
        ? Math.round((covered / topics.length) * 100) + "%"
        : "0%",
      rows,
    },
    notes,
    topics,
    matches,
  };
}

export function renderCoverageTxt(c: CoverageOutput): string {
  const lines: string[] = [];
  lines.push(`# 关键词类目覆盖率报告 · ${new Date().toISOString()}`);
  lines.push("");
  lines.push(`总类目数: ${c.totalCategories}`);
  lines.push(`已覆盖类目: ${c.covered}`);
  lines.push(`覆盖率: ${c.coveragePercent} (${c.covered}/${c.totalCategories})`);
  lines.push("");
  lines.push("| # | 类型 | 类目名称 | 命中条数 | 覆盖 |");
  lines.push("|---|------|----------|----------|------|");
  for (const r of c.rows) {
    lines.push(
      `| ${r.index} | ${r.type} | ${r.name} | ${r.hitCount} | ${r.covered ? "✅" : "❌"} |`
    );
  }
  lines.push("");
  lines.push("未覆盖类目：");
  const missing = c.rows.filter((r) => !r.covered).map((r) => r.name);
  lines.push(missing.length ? missing.join("、") : "（无）");
  return lines.join("\n");
}

export function renderRankingMd(input: {
  notes: XhsNote[];
  matches: MatchResult[];
}): string {
  const lines: string[] = [];
  lines.push("# 关键词笔记热度榜 TOP-N");
  lines.push("");
  lines.push(
    "排序权重 = 点赞数 `likeCount` + 2 × 收藏数 `collectCount`。仅列未下架笔记。"
  );
  lines.push("");
  for (const m of input.matches) {
    lines.push(`## ${m.topic.name}（类型：${m.topic.type}，命中 ${m.hitNoteIds.length} 条）`);
    lines.push("");
    const rows = m.hitNoteIds
      .map((id) => input.notes.find((n) => n.noteId === id))
      .filter((n): n is XhsNote => !!n)
      .sort((a, b) => score(b) - score(a))
      .slice(0, 20);
    lines.push("| 排名 | noteId | 标题 | 作者 | 点赞 | 收藏 | 评论 | 权重分 |");
    lines.push("|-----:|--------|------|------|-----:|-----:|-----:|-------:|");
    rows.forEach((n, i) => {
      const title = (n.title ?? "(无标题)").replace(/\|/g, "\\|").slice(0, 40);
      lines.push(
        `| ${i + 1} | \`${n.noteId}\` | ${title} | ${n.authorNickname.replace(/\|/g, "\\|")} | ${n.likeCount ?? 0} | ${n.collectCount ?? 0} | ${n.commentCount ?? 0} | ${score(n)} |`
      );
    });
    if (rows.length === 0) lines.push("_（该类目暂无有效笔记）_");
    lines.push("");
  }
  return lines.join("\n");
}

export function main(argv: string[] = process.argv): number {
  const program = new Command();
  program
    .name("export-topics")
    .description("关键词覆盖率报告 + 热度榜")
    .option("--coverage", "仅输出 coverage.txt (stdout)")
    .option("--ranking", "仅输出 TOPICS_RANKING.md (stdout)")
    .option("--root <dir>", "素材库根目录", ROOT)
    .option(
      "--out-dir <dir>",
      "输出目录，默认 <root>；在此目录下写 coverage.txt 和 TOPICS_RANKING.md"
    )
    .action(() => {
      const opts = program.opts<{
        coverage?: boolean;
        ranking?: boolean;
        root: string;
        outDir?: string;
      }>();
      const outDir = opts.outDir ?? opts.root;
      fs.mkdirSync(outDir, { recursive: true });

      const res = computeCoverage(opts.root);
      const covTxt = renderCoverageTxt(res.coverage);
      const rankMd = renderRankingMd({ notes: res.notes, matches: res.matches });

      if (opts.coverage && !opts.ranking) {
        process.stdout.write(covTxt + "\n");
      } else if (opts.ranking && !opts.coverage) {
        process.stdout.write(rankMd + "\n");
      } else {
        // 默认：写两个文件 + stdout 打印 coverage 摘要
        fs.writeFileSync(path.join(outDir, "coverage.txt"), covTxt + "\n");
        fs.writeFileSync(path.join(outDir, "TOPICS_RANKING.md"), rankMd + "\n");
        console.log(covTxt);
        console.log(`\n📄 coverage.txt  → ${path.join(outDir, "coverage.txt")}`);
        console.log(`📄 TOPICS_RANKING.md → ${path.join(outDir, "TOPICS_RANKING.md")}`);
      }
      process.exit(0);
    });
  try {
    program.parse(argv, { from: "user" });
  } catch (e) {
    console.error((e as Error).message);
    return 2;
  }
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.exit(main(process.argv));
}
