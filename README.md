# jacklewis0221.github.io

Personal site for Jack Lewis, embedded software engineer in Saint Paul, Minnesota.

**Live:** https://jacklewis0221.github.io/

The site goes deeper than a résumé can: a case file for each role, a generalized case study of the Common Service Tool with an explicit split between my work, the team's work, and inherited components, a J1939 trouble-code builder, and links to public projects.

## The hero capture

The oscilloscope in the hero is not a looped video. `assets/js/scope.js` builds a real J1939 broadcast and encodes every frame bit by bit:

- **Message:** a BAM transport session (TP.CM, then five TP.DT packets) carrying PGN 65259, Component Identification, from source address `0xF9`, the address reserved for an off-board service tool.
- **Payload:** `LEWIS*JACK*EMBEDDED SW*ST PAUL MN*` in the Make, Model, Serial, and Unit fields.
- **Frames:** CAN 2.0B extended frames with SRR/IDE, DLC, CRC-15 (polynomial `0x4599`), bit stuffing from SOF through the CRC sequence, ACK, EOF, and intermission.
- **Display:** CAN_H and CAN_L at 500 mV/div around 2.5 V, 50 µs/div at 250 kbit/s, with a decode lane and stuff bits marked with dots. Playback is slowed for viewing, pauses when the capture is off screen, and renders a static frame when the visitor prefers reduced motion.

`window.__busCapture` in the browser console lists each frame's identifier, data, CRC, and bit and stuff-bit counts.

## Running locally

It is a static site with no build step.

```sh
npx serve .
# or
python3 -m http.server 8000
```

## Structure

```
index.html            all content
404.html              error-frame page
assets/css/           base.css (reset) and style.css (tokens, components, print)
assets/js/scope.js    J1939 / CAN bit-level hero capture
assets/js/main.js     menu, case files, architecture explorer, DTC builder
assets/fonts/         self-hosted Archivo and JetBrains Mono (SIL OFL 1.1)
assets/img/           project screenshots and the social preview image
```

## Credits

Fonts: [Archivo](https://github.com/Omnibus-Type/Archivo) and [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono), both under the SIL Open Font License 1.1 (license texts in `assets/fonts/`). Icons are adapted from [Lucide](https://lucide.dev) (ISC).

Content © 2026 John "Jack" Lewis.
