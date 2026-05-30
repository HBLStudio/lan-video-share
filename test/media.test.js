const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { listVideos, resolveInsideRoot } = require("../src/media");
const { parseRange } = require("../src/server");

test("listVideos recursively returns supported video files", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lan-video-share-"));
  await fs.mkdir(path.join(root, "nested"));
  await fs.writeFile(path.join(root, "a.mp4"), "video");
  await fs.writeFile(path.join(root, "nested", "b.mov"), "video");
  await fs.writeFile(path.join(root, "nested", "note.txt"), "text");

  const videos = await listVideos(root);
  assert.equal(videos.length, 2);
  assert.deepEqual(videos.map((item) => item.id).sort(), ["a.mp4", "nested/b.mov"]);
});

test("resolveInsideRoot rejects traversal outside the shared root", () => {
  const root = path.resolve(os.tmpdir(), "shared-root");
  assert.equal(resolveInsideRoot(root, "../secret.mp4"), null);
  assert.equal(resolveInsideRoot(root, "folder/video.mp4"), path.join(root, "folder", "video.mp4"));
});

test("parseRange handles normal and suffix byte ranges", () => {
  assert.deepEqual(parseRange("bytes=10-19", 100), { start: 10, end: 19 });
  assert.deepEqual(parseRange("bytes=90-", 100), { start: 90, end: 99 });
  assert.deepEqual(parseRange("bytes=-10", 100), { start: 90, end: 99 });
  assert.equal(parseRange("bytes=99-10", 100), null);
});
