// Shared by the browser and the regression tests. All media times are seconds.
(function (root, factory) {
  const timeline = factory();
  if (typeof module === 'object' && module.exports) module.exports = timeline;
  else root.MediaTimeline = timeline;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function duration(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
  }

  function formatTime(value) {
    if (!Number.isFinite(value) || value < 0) return '0:00';
    const seconds = Math.floor(value);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }

  function storyCues(subtitles, mediaDuration = null, expectedDuration = null) {
    if (!Array.isArray(subtitles) || subtitles.length === 0) return { status: 'unavailable', cues: [] };
    // A longer/shorter recording can have inserted content, even if every cue fits.
    // An explicitly supplied recording duration must match; do not retime by ratio.
    if (duration(mediaDuration) !== null && duration(expectedDuration) !== null &&
        Math.abs(mediaDuration - expectedDuration) > 0.5) return { status: 'invalid', cues: [] };
    const cues = [];
    for (const cue of subtitles) {
      if (!cue || typeof cue.start !== 'number' || !Number.isFinite(cue.start) || cue.start < 0 ||
          typeof cue.end !== 'number' || !Number.isFinite(cue.end) || cue.end <= cue.start ||
          typeof cue.text !== 'string' || !cue.text.trim() ||
          (cues.length && cue.start < cues[cues.length - 1].end) ||
          (duration(mediaDuration) !== null && cue.end > mediaDuration + 0.05)) {
        return { status: 'invalid', cues: [] };
      }
      cues.push({ time: cue.start, end: cue.end, text: cue.text.trim(),
        translation: typeof cue.translation === 'string' ? cue.translation.trim() : '' });
    }
    return { status: 'timed', cues };
  }

  function activeCue(cues, currentTime, mediaDuration = null) {
    if (!Number.isFinite(currentTime) || currentTime < 0 ||
        (duration(mediaDuration) !== null && currentTime >= mediaDuration)) return -1;
    for (let i = cues.length - 1; i >= 0; i--) {
      if (currentTime >= cues[i].time) {
        return Number.isFinite(cues[i].end) && currentTime >= cues[i].end ? -1 : i;
      }
    }
    return -1;
  }

  return { duration, formatTime, storyCues, activeCue };
});
