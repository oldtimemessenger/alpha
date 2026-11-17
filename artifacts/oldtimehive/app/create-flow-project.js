import { createLayer, createProject } from "./creative-project.js";

const MAX_CAROUSEL_PHOTOS = 10;

function photoScene(media, width, height) {
  const scene = createProject();
  scene.width = width;
  scene.height = height;
  scene.background = { kind: "photo", media, color: "#f2f3f5", fit: "contain" };
  return scene;
}

function readableTextColor(color) {
  const normalized = String(color || "").replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return "#ffffff";
  const channels = [0, 2, 4].map(offset => parseInt(normalized.slice(offset, offset + 2), 16) / 255);
  const luminance = channels.map(value => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  return luminance > 0.45 ? "#17191c" : "#ffffff";
}

export function createPhotoCarouselProject(files, {
  createObjectURL = file => URL.createObjectURL(file),
  revokeObjectURL = url => URL.revokeObjectURL(url),
} = {}) {
  if (!Array.isArray(files) || files.length < 2 || files.length > MAX_CAROUSEL_PHOTOS ||
    files.some(file => !String(file?.type || "").startsWith("image/"))) {
    throw new Error("Choose 2 to 10 photos for a swipeable post.");
  }
  const urls = [];
  try {
    const width = 1080, height = 1350;
    const scenes = files.map(file => {
      const url = createObjectURL(file);
      urls.push(url);
      return photoScene(url, width, height);
    });
    const project = structuredClone(scenes[0]);
    project.pages = scenes;
    project.activePage = 0;
    return { project, release: () => urls.forEach(revokeObjectURL) };
  } catch (error) {
    urls.forEach(revokeObjectURL);
    throw error;
  }
}

export function createTextPostProject(text, color = "#1456d9") {
  const value = String(text || "").trim();
  if (!value) throw new Error("Write something before continuing.");
  const project = createProject();
  project.background = { kind: "color", color, media: "" };
  project.outputKind = "photo";
  project.layers.push(createLayer("text", {
    text: value,
    x: 0.5,
    y: 0.5,
    width: 920,
    fontSize: 112,
    color: readableTextColor(color),
    font: "Manrope",
    bold: true,
    shadow: false,
    backgroundOn: false,
    endTime: project.duration,
  }));
  return project;
}
