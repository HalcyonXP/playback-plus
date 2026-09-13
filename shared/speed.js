(() => {
  "use strict";

  const DEFAULT_SPEED = 1;
  const DEFAULT_ALTERNATE_SPEED = 2;
  const SAVED_DEFAULT_KEY = "savedSpeedDefault";
  const NORMAL_SPEED = 1;
  const MIN_SPEED = 0.25;
  const MAX_SPEED = 8;
  const SPEED_STEP = 0.25;
  const STORAGE_KEY = "playbackSpeed";
  const LAST_NON_1X_SPEED_KEY = "lastNon1xSpeed";
  const LEGACY_STORAGE_KEY = "defaultSpeed";
  const RATE_EPSILON = 0.001;

  function normalizeSpeed(value, fallback = DEFAULT_SPEED) {
    const parsed = Number(value);
    const fallbackNumber = Number(fallback);
    const safeFallback = Number.isFinite(fallbackNumber)
      ? fallbackNumber
      : DEFAULT_SPEED;
    const finiteValue = Number.isFinite(parsed) ? parsed : safeFallback;
    const clamped = Math.min(MAX_SPEED, Math.max(MIN_SPEED, finiteValue));
    const stepped = Math.round(clamped / SPEED_STEP) * SPEED_STEP;

    return Number(stepped.toFixed(2));
  }

  function speedsMatch(first, second) {
    return Number.isFinite(Number(first))
      && Number.isFinite(Number(second))
      && Math.abs(Number(first) - Number(second)) < RATE_EPSILON;
  }

  function isNormalSpeed(value) {
    return speedsMatch(normalizeSpeed(value), NORMAL_SPEED);
  }

  function normalizeLastNon1xSpeed(value, fallback = DEFAULT_ALTERNATE_SPEED) {
    const normalizedFallback = normalizeSpeed(fallback, DEFAULT_ALTERNATE_SPEED);
    const safeFallback = isNormalSpeed(normalizedFallback)
      ? DEFAULT_ALTERNATE_SPEED
      : normalizedFallback;
    const normalizedValue = normalizeSpeed(value, safeFallback);

    return isNormalSpeed(normalizedValue) ? safeFallback : normalizedValue;
  }

  function createSpeedState(speedValue, lastNon1xSpeedValue = DEFAULT_ALTERNATE_SPEED) {
    const speed = normalizeSpeed(speedValue, DEFAULT_SPEED);
    const lastNon1xSpeed = isNormalSpeed(speed)
      ? normalizeLastNon1xSpeed(lastNon1xSpeedValue, DEFAULT_ALTERNATE_SPEED)
      : speed;

    return { speed, lastNon1xSpeed };
  }

  function readSpeedState(storedValues = {}) {
    const speedValue = storedValues[STORAGE_KEY]
      ?? storedValues[LEGACY_STORAGE_KEY]
      ?? DEFAULT_SPEED;

    return createSpeedState(
      speedValue,
      storedValues[LAST_NON_1X_SPEED_KEY]
    );
  }

  function updateSpeedState(currentState, speedValue) {
    return createSpeedState(
      speedValue,
      currentState?.lastNon1xSpeed ?? DEFAULT_ALTERNATE_SPEED
    );
  }

  function toggleSpeedState(currentState) {
    const normalizedState = createSpeedState(
      currentState?.speed,
      currentState?.lastNon1xSpeed
    );
    const nextSpeed = isNormalSpeed(normalizedState.speed)
      ? normalizedState.lastNon1xSpeed
      : NORMAL_SPEED;

    return updateSpeedState(normalizedState, nextSpeed);
  }

  function toStoredSpeedState(state) {
    const normalizedState = createSpeedState(
      state?.speed,
      state?.lastNon1xSpeed
    );

    return {
      [STORAGE_KEY]: normalizedState.speed,
      [LAST_NON_1X_SPEED_KEY]: normalizedState.lastNon1xSpeed
    };
  }

  // A default is always a fixed snapshot. Preserve an old On snapshot; migrate
  // Off/missing settings from the speed those settings would have used for a new
  // tab. The background persists this once before subsequent explicit choices.
  // Keep the enabled field/key for storage continuity, but never expose Off now.
  function readSpeedDefaults(storedValues = {}) {
    const latest = readSpeedState(storedValues);
    const saved = storedValues[SAVED_DEFAULT_KEY];
    return {
      enabled: true,
      speed: normalizeSpeed(saved?.enabled === true ? saved.speed ?? latest.speed : latest.speed),
      latestSpeed: latest.speed,
      lastNon1xSpeed: latest.lastNon1xSpeed
    };
  }

  function seedSpeedState(storedValues = {}) {
    const defaults = readSpeedDefaults(storedValues);
    return createSpeedState(defaults.speed, defaults.lastNon1xSpeed);
  }

  function formatSpeed(value) {
    const speed = normalizeSpeed(value);
    return `${Number.isInteger(speed) ? speed.toFixed(0) : speed.toFixed(2).replace(/0$/, "")}×`;
  }

  globalThis.VideoSpeedUtils = Object.freeze({
    DEFAULT_SPEED,
    DEFAULT_ALTERNATE_SPEED,
    SAVED_DEFAULT_KEY,
    readSpeedDefaults,
    seedSpeedState,
    NORMAL_SPEED,
    MIN_SPEED,
    MAX_SPEED,
    SPEED_STEP,
    STORAGE_KEY,
    LAST_NON_1X_SPEED_KEY,
    LEGACY_STORAGE_KEY,
    normalizeSpeed,
    speedsMatch,
    isNormalSpeed,
    normalizeLastNon1xSpeed,
    createSpeedState,
    readSpeedState,
    updateSpeedState,
    toggleSpeedState,
    toStoredSpeedState,
    formatSpeed
  });
})();
