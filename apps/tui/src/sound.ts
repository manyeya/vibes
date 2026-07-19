// A short "task done" chime, played via OpenTUI's native audio. The sound is
// synthesized in code as a WAV byte buffer (miniaudio decodes it), so there's
// no asset to ship. Engine init is lazy + guarded: on a machine with no audio
// device (CI, headless) it degrades to silence, never a crash.
import { Audio, type AudioSound } from '@opentui/core';

const SAMPLE_RATE = 44100;

// Two soft sine notes, ascending (C5 → G5), each with a fast click-free attack
// and an exponential decay — a gentle two-note "ding", not a harsh beep.
function buildChimeWav(): Uint8Array {
  const notes = [523.25, 783.99];
  const perNote = Math.floor(SAMPLE_RATE * 0.12);
  const total = perNote * notes.length;

  const dataSize = total * 2; // 16-bit mono
  const buf = new ArrayBuffer(44 + dataSize);
  const dv = new DataView(buf);
  const str = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  dv.setUint32(4, 36 + dataSize, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  dv.setUint32(16, 16, true); // fmt chunk size
  dv.setUint16(20, 1, true); // PCM
  dv.setUint16(22, 1, true); // mono
  dv.setUint32(24, SAMPLE_RATE, true);
  dv.setUint32(28, SAMPLE_RATE * 2, true); // byte rate
  dv.setUint16(32, 2, true); // block align
  dv.setUint16(34, 16, true); // bits/sample
  str(36, 'data');
  dv.setUint32(40, dataSize, true);

  let off = 44;
  notes.forEach((freq, ni) => {
    for (let i = 0; i < perNote; i++) {
      const t = i / SAMPLE_RATE;
      const env = Math.exp(-5 * t) * (1 - Math.exp(-200 * t)); // decay × soft attack
      const s = Math.sin(2 * Math.PI * freq * t) * env * 0.5;
      dv.setInt16(off + (ni * perNote + i) * 2, Math.max(-1, Math.min(1, s)) * 0x7fff, true);
    }
  });
  return new Uint8Array(buf);
}

let audio: Audio | null = null;
let sound: AudioSound | null = null;
let failed = false;

function ensureInit(): void {
  if (audio || failed) return;
  try {
    audio = Audio.create({ autoStart: true });
    audio.on('error', () => {}); // swallow device/engine errors — stay silent
    sound = audio.loadSound(buildChimeWav());
    if (sound == null) failed = true;
  } catch {
    failed = true;
    audio = null;
  }
}

/** Play the completion chime. No-op if audio isn't available. */
export function playDone(): void {
  ensureInit();
  if (!audio || sound == null) return;
  try {
    audio.play(sound, { volume: 0.4 });
  } catch {
    /* transient playback failure — ignore */
  }
}
