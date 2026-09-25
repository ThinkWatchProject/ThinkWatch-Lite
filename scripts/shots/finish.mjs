// 截图的最后一步：把拍下来的原图收进 docs/screenshots/，再给官网出一份。
//
//   node scripts/shots/finish.mjs <原图目录> <docs/screenshots>
//
// - **仓库里放的是 256 色的 PNG**（原图是 RGBA，一张几百 KB；界面截图量化之后肉眼看不出
//   差别，一张一百来 KB）。目录结构照原图：`zh/`、`en/` 下各一套，菜单栏那一块在最上层。
// - **官网用的在 `web/`**，照官网 public/lite/ 的叫法：深色那一张，webp、质量 85，中文界面
//   叫 `<名字>.webp`，英文界面加 `-en`；菜单栏那一块是深色的 PNG（官网本来就用 PNG）。
//   官网那边整个拷过去就行。webp 从原图出，不从量化过的出。
import { mkdir, readdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import sharp from "sharp";

const [raw, out] = process.argv.slice(2);
if (!raw || !out) {
  console.error("用法：node scripts/shots/finish.mjs <原图目录> <docs/screenshots>");
  process.exit(2);
}

async function* pngs(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* pngs(p);
    else if (e.name.endsWith(".png")) yield p;
  }
}

const write = async (img, to) => {
  await mkdir(dirname(to), { recursive: true });
  const { width, height, size } = await img.toFile(to);
  console.log(`  ${relative(process.cwd(), to)}  ${width}×${height}  ${Math.round(size / 1024)} KB`);
};

for await (const p of pngs(raw)) {
  const rel = relative(raw, p);
  // 144 dpi：在预览里按 1 倍的大小打开，和原图一样
  await write(sharp(p).png({ palette: true, quality: 100, effort: 10, compressionLevel: 9 }).withMetadata({ density: 144 }), join(out, rel));

  const m = /^(zh|en)\/(.+)-dark\.png$/.exec(rel);
  if (m) {
    const [, lang, name] = m;
    await write(sharp(p).webp({ quality: 85 }), join(out, "web", `${name}${lang === "en" ? "-en" : ""}.webp`));
  } else if (rel === "menubar-dark.png") {
    await write(sharp(p).png({ palette: true, quality: 100, effort: 10, compressionLevel: 9 }), join(out, "web", "menubar.png"));
  }
}
