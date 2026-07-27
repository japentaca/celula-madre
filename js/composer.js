const Composer = (() => {
  let composedSequence = [];
  let isPlaying = false;
  let playbackTimeout = null;
  let currentStepIndex = 0;
  let onStepCallback = null;
  let onCompleteCallback = null;
  let lastAbsoluteStart = 0;

  function compose(tracks, motifs, formStr, cellLength) {
    composedSequence = [];
    const formParts = formStr.split('-');
    const sectionCount = formParts.length;
    let timeOffset = 0;
    for (let sec = 0; sec < sectionCount; sec++) {
      for (let step = 0; step < cellLength; step++) {
        for (let t = 0; t < tracks.length; t++) {
          const track = tracks[t];
          if (track.silenced) continue;
          if (track.motifIndex === null) continue;
          const motif = motifs ? motifs[track.motifIndex] : null;
          if (!motif || motif.length === 0) continue;
          const motifIdx = step % motif.length;
          if (!motif[motifIdx].note) continue;
          composedSequence.push({
            time: timeOffset + step,
            trackIndex: t,
            preset: track.preset,
            note: motif[motifIdx].pitch,
            velocity: motif[motifIdx].velocity,
            duration: '1n'
          });
        }
      }
      timeOffset += cellLength;
    }
    return composedSequence;
  }

  function getSequence() {
    return composedSequence;
  }

  function play(onStep, onComplete) {
    if (isPlaying) return;
    onStepCallback = onStep;
    onCompleteCallback = onComplete;
    if (composedSequence.length === 0) return;

    isPlaying = true;
    currentStepIndex = 0;

    const now = Tone.now();
    const absStart = Math.max(now + 0.1, lastAbsoluteStart + 0.001);
    lastAbsoluteStart = absStart;

    for (let i = 0; i < composedSequence.length; i++) {
      const event = composedSequence[i];
      const eventTime = absStart + event.time;
      Tone.Transport.schedule((time) => {
        if (onStepCallback) onStepCallback(currentStepIndex);
        currentStepIndex++;
        AudioEngine.playNote(
          event.preset,
          event.note,
          time,
          event.duration,
          event.velocity
        );
      }, eventTime);
    }

    Tone.Transport.start(absStart.toString());

    const totalDuration = composedSequence[composedSequence.length - 1].time + absStart + 2;
    playbackTimeout = setTimeout(() => {
      if (isPlaying) {
        doStop();
        if (onCompleteCallback) onCompleteCallback();
      }
    }, totalDuration * 1000);
  }

  function doStop() {
    if (!isPlaying) return;
    isPlaying = false;
    Tone.Transport.stop();
    Tone.Transport.cancel();
    if (playbackTimeout) {
      clearTimeout(playbackTimeout);
      playbackTimeout = null;
    }
    currentStepIndex = 0;
  }

  function stop() {
    doStop();
  }

  function getIsPlaying() {
    return isPlaying;
  }

  return { compose, play, stop, getSequence, getIsPlaying };
})();