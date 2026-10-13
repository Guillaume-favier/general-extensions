/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

// comix challenges bursty/concurrent traffic, so run one WebView at a time. The
// chain is reset on both branches so a rejected task doesn't poison the ones
// queued behind it.
let tail: Promise<void> = Promise.resolve();

export function scheduleComix<T>(task: () => Promise<T>): Promise<T> {
  const run = tail.then(task);
  tail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
