# Meditation sounds

Drop your ambient audio files here. The Meditate page looks for these exact
filenames:

- `rain.mp3`
- `forest.mp3`
- `ocean.mp3`
- `bowls.mp3`

They are picked up automatically (via `import.meta.glob`) — no code changes
needed. Until a file is present, selecting that sound simply plays nothing.
"None" never plays audio.
