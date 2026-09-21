const enter = document.querySelector("#enter");
const tracks = [...document.querySelectorAll(".track")];
const videos = [...document.querySelectorAll(".scene__video")];
const musicWindows = [...document.querySelectorAll(".music-window")];
const scenePages = [...document.querySelectorAll(".scene-page")];
const scenePanels = [...document.querySelectorAll(".scene")];
const windowPointer = document.querySelector("#window-pointer");

let audioContext;
let channels = [];
let started = false;
let activeScene = 0;
let touchOpenScene = null;
let pointerPosition = null;

const LOW_FREQUENCY = 260;
const OPEN_FREQUENCY = 18000;
const QUIET_GAIN = 0.82;
const OPEN_GAIN = 1.18;
const OUTSIDE_MAX_PROXIMITY = 0.7;
const PROXIMITY_RADIUS = 0.08;

history.scrollRestoration = "manual";
window.scrollTo(0, 0);

function loopPoints(track) {
  return {
    start: Number(track.dataset.loopStart || 0),
    end: Number(track.dataset.loopEnd || track.duration || Infinity),
  };
}

function resetToLoopStart(track) {
  const { start, end } = loopPoints(track);
  if (track.currentTime < start || track.currentTime >= end) track.currentTime = start;
}

tracks.forEach((track) => {
  const prepareLoop = () => resetToLoopStart(track);
  if (track.readyState >= 1) prepareLoop();
  else track.addEventListener("loadedmetadata", prepareLoop, { once: true });

  track.addEventListener("timeupdate", () => {
    const { start, end } = loopPoints(track);
    if (track.currentTime >= end - 0.18) track.currentTime = start;
  });
  track.addEventListener("ended", () => {
    resetToLoopStart(track);
    if (Number(track.dataset.scene) === activeScene && started) track.play();
  });
});

function setProximity(sceneIndex, proximity, immediate = false) {
  const amount = Math.max(0, Math.min(1, proximity));
  const hotspot = musicWindows[sceneIndex];
  hotspot.setAttribute("aria-pressed", String(amount > 0.96));
  const channel = channels[sceneIndex];
  if (!channel || !audioContext) return;

  const now = audioContext.currentTime;
  const duration = immediate ? 0.01 : 0.09;
  const frequency = LOW_FREQUENCY * ((OPEN_FREQUENCY / LOW_FREQUENCY) ** amount);
  const volume = QUIET_GAIN + (OPEN_GAIN - QUIET_GAIN) * amount;
  channel.filter.frequency.cancelScheduledValues(now);
  channel.filter.frequency.setValueAtTime(Math.max(20, channel.filter.frequency.value), now);
  channel.filter.frequency.exponentialRampToValueAtTime(frequency, now + duration);
  channel.windowGain.gain.cancelScheduledValues(now);
  channel.windowGain.gain.setValueAtTime(channel.windowGain.gain.value, now);
  channel.windowGain.gain.linearRampToValueAtTime(volume, now + duration);
}

function setFilter(sceneIndex, open, immediate = false) {
  setProximity(sceneIndex, open ? 1 : 0, immediate);
}

function proximityToWindow(sceneIndex, clientX, clientY) {
  const hotspotRect = musicWindows[sceneIndex].getBoundingClientRect();
  const sceneRect = scenePanels[sceneIndex].getBoundingClientRect();
  const hit = document.elementFromPoint(clientX, clientY);
  const isInsideWindow = hit === musicWindows[sceneIndex] || musicWindows[sceneIndex].contains(hit);

  if (isInsideWindow) return 1;

  const dx = Math.max(hotspotRect.left - clientX, 0, clientX - hotspotRect.right);
  const dy = Math.max(hotspotRect.top - clientY, 0, clientY - hotspotRect.bottom);
  const distance = Math.hypot(dx, dy);
  const influenceRadius = Math.hypot(sceneRect.width, sceneRect.height) * PROXIMITY_RADIUS;
  const linear = Math.max(0, 1 - distance / influenceRadius);
  const smooth = linear * linear * (3 - 2 * linear);
  return OUTSIDE_MAX_PROXIMITY * smooth ** 1.15;
}

function updateWindowPointer(clientX, clientY) {
  const hotspot = musicWindows[activeScene];
  if (!hotspot || !windowPointer) return;
  const rect = hotspot.getBoundingClientRect();
  const centreX = rect.left + rect.width / 2;
  const centreY = rect.top + rect.height / 2;
  const angle = Math.atan2(centreY - clientY, centreX - clientX) * 180 / Math.PI;
  const hit = document.elementFromPoint(clientX, clientY);
  const isInside = hit === hotspot || hotspot.contains(hit);

  windowPointer.style.left = `${clientX}px`;
  windowPointer.style.top = `${clientY}px`;
  windowPointer.style.setProperty("--pointer-angle", `${angle}deg`);
  windowPointer.classList.toggle("is-inside", isInside);
  windowPointer.classList.add("is-visible");
}

async function activateScene(nextScene) {
  if (nextScene === activeScene && (!started || !tracks[nextScene].paused)) return;
  const previousScene = activeScene;
  activeScene = nextScene;
  touchOpenScene = null;
  if (pointerPosition) updateWindowPointer(pointerPosition.x, pointerPosition.y);

  musicWindows.forEach((hotspot, index) => {
    hotspot.setAttribute("aria-pressed", "false");
    if (channels[index]) setFilter(index, false, true);
  });

  if (!started || !audioContext) return;
  const now = audioContext.currentTime;
  const previous = channels[previousScene];
  const next = channels[nextScene];

  previous.level.gain.cancelScheduledValues(now);
  previous.level.gain.setValueAtTime(previous.level.gain.value, now);
  previous.level.gain.linearRampToValueAtTime(0, now + 0.28);
  window.setTimeout(() => {
    if (activeScene !== previousScene) tracks[previousScene].pause();
  }, 320);

  next.level.gain.cancelScheduledValues(now);
  next.level.gain.setValueAtTime(0, now);
  next.level.gain.linearRampToValueAtTime(1, now + 0.35);
  resetToLoopStart(tracks[nextScene]);
  await tracks[nextScene].play();
}

async function startExperience() {
  if (started) return;
  audioContext = new AudioContext();
  channels = tracks.map((track, index) => {
    const source = audioContext.createMediaElementSource(track);
    const filter = audioContext.createBiquadFilter();
    const windowGain = audioContext.createGain();
    const level = audioContext.createGain();
    filter.type = "lowpass";
    filter.Q.value = 0.8;
    filter.frequency.value = LOW_FREQUENCY;
    windowGain.gain.value = QUIET_GAIN;
    level.gain.value = index === activeScene ? 1 : 0;
    source.connect(filter).connect(windowGain).connect(level).connect(audioContext.destination);
    return { filter, windowGain, level };
  });

  await audioContext.resume();
  tracks.forEach(resetToLoopStart);
  await Promise.allSettled([...videos.map((video) => video.play()), tracks[activeScene].play()]);
  started = true;
}

enter.addEventListener("click", async () => {
  if (enter.classList.contains("is-unwriting")) return;
  enter.classList.add("is-unwriting");
  window.setTimeout(() => enter.classList.add("is-gone"), 1320);
  await startExperience();
});

document.addEventListener("pointermove", (event) => {
  if (event.pointerType === "touch") return;
  pointerPosition = { x: event.clientX, y: event.clientY };
  updateWindowPointer(event.clientX, event.clientY);
}, { passive: true });

document.documentElement.addEventListener("mouseleave", () => {
  pointerPosition = null;
  windowPointer.classList.remove("is-visible");
});

scenePanels.forEach((scene, sceneIndex) => {
  scene.addEventListener("pointermove", (event) => {
    if (!started || sceneIndex !== activeScene || event.pointerType === "touch") return;
    setProximity(sceneIndex, proximityToWindow(sceneIndex, event.clientX, event.clientY));
  });
  scene.addEventListener("pointerleave", (event) => {
    if (event.pointerType !== "touch" && touchOpenScene !== sceneIndex) {
      setProximity(sceneIndex, 0);
    }
  });
});

musicWindows.forEach((hotspot) => {
  const sceneIndex = Number(hotspot.dataset.scene);
  hotspot.addEventListener("focus", () => {
    if (sceneIndex === activeScene) setFilter(sceneIndex, true);
  });
  hotspot.addEventListener("blur", () => {
    if (touchOpenScene !== sceneIndex) setFilter(sceneIndex, false);
  });
  hotspot.addEventListener("click", async (event) => {
    if (!started) await startExperience();
    if (event.pointerType === "touch" || matchMedia("(hover: none)").matches) {
      touchOpenScene = touchOpenScene === sceneIndex ? null : sceneIndex;
      setFilter(sceneIndex, touchOpenScene === sceneIndex);
    }
  });
});

const sceneObserver = new IntersectionObserver(
  (entries) => {
    const visible = entries
      .filter((entry) => entry.isIntersecting)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (visible && visible.intersectionRatio >= 0.55) {
      activateScene(Number(visible.target.dataset.scene));
    }
  },
  { threshold: [0.55, 0.7, 0.9] },
);
scenePages.forEach((page) => sceneObserver.observe(page));

document.addEventListener("pointerdown", (event) => {
  if (touchOpenScene === null) return;
  if (musicWindows[touchOpenScene].contains(event.target)) return;
  setFilter(touchOpenScene, false);
  touchOpenScene = null;
});

document.addEventListener("visibilitychange", () => {
  if (!audioContext) return;
  if (document.hidden) audioContext.suspend();
  else if (started) audioContext.resume();
});
