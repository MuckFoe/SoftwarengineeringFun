# 007 — Chat GIF search: notes

## 2026-11-04 — drift found on the live hub

- Every search and trending list showed "No GIFs found" with a real `GIPHY_API_KEY`.
  GIPHY's `bundle=messaging_non_clips` returns only `fixed_height*`, `fixed_width`,
  `fixed_width_downsampled`, `fixed_width_small` and `original`, with no `*_still`
  renditions. `parse_result` requires `fixed_width_still` (NFR-6 reduced motion), so it
  dropped all 24 results. The fake GIPHY always returned a still, which hid the problem.
- Fix: the client no longer sends `bundle` (plan.md updated). The fake now strips
  `*_still` renditions whenever `bundle` is present, as real GIPHY does, so reintroducing
  the parameter fails `test_giphy_client.py`.
- The by-id lookup used when posting never sent `bundle` and was unaffected.
