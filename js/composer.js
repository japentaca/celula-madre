const Composer = (() => {
  let composedSequence = [];
  let isPlaying = false;
  let playbackTimeout = null;
  let currentStepIndex = 0;
  let onStepCallback = null;
  let onCompleteCallback = null;

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
    if (isPlaying) stop();
    onStepCallback = onStep;
    onCompleteCallback = onComplete;
    if (composedSequence.length === 0) return;

    isPlaying = true;
    currentStepIndex = 0;
    Tone.Transport.start();

    const startTime = Tone.now();
    for (const event of composedSequence) {
      const eventTime = startTime + event.time;
      Tone.Transport.schedule(() => {
        if (onStepCallback) onStepCallback(currentStepIndex);
        currentStepIndex++;
        AudioEngine.playNote(
          event.preset,
          event.note,
          Tone.now(),
          event.duration,
          event.velocity
        );
      }, eventTime);
    }

    const totalDuration = composedSequence[composedSequence.length - 1].time + 2;
    playbackTimeout = setTimeout(() => {
      if (isPlaying) {
        stop();
        if (onCompleteCallback) onCompleteCallback();
      }
    }, totalDuration * 1000);
  }

  function stop() {
    isPlaying = false;
    Tone.Transport.stop();
    Tone.Transport.cancel();
    if (playbackTimeout) {
      clearTimeout(playbackTimeout);
      playbackTimeout = null;
    }
    currentStepIndex = 0;
  }

  function getIsPlaying() {
    return isPlaying;
  }

  return { compose, play, stop, getSequence, getIsPlaying };
})();