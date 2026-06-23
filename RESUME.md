# How to resume this build

This project is built **incrementally**, one phase at a time, with a commit at
the end of every phase. If the build pauses — because a Claude usage limit was
hit, the loop was stopped, or you closed the terminal — **no work is lost** and
you can always pick up exactly where it left off.

## What "paused" means
- You hit your Claude usage limit mid-build, **or**
- The build loop finished an increment and stopped, **or**
- You manually stopped it.

In every case the last *completed* phase is committed to git, and `PROGRESS.md`
records what's done and what's next.

## How state is tracked
- **`PROGRESS.md`** — the source of truth for "where are we": current phase, the
  task checklist for that phase, and what's next. Updated at every checkpoint.
- **git history** — one commit per completed phase (`git log --oneline`). The
  working tree at HEAD is always a known-good, verified state.
- **`VERIFY.md`** — the most recent independent verifier verdict (Reviewer +
  Tester findings) for the phase in progress. If it shows failures, those are
  the things to fix before advancing.

## How to resume
1. Open a terminal in this folder: `cd ~/Downloads/jobhunting`
2. Check where you are:
   ```bash
   cat PROGRESS.md          # current phase + next step
   git log --oneline        # last completed phase = last commit
   cat VERIFY.md            # any open findings from the verifier
   ```
3. Restart the build loop (it reads `PROGRESS.md` and continues from the last
   committed state — it does NOT redo finished phases):
   ```bash
   # In Claude Code (terminal), self-paced loop:
   /loop continue the job-hunter build from PROGRESS.md
   ```
   Or, for a single increment without the loop, just tell Claude Code:
   > "Continue the job-hunter build from PROGRESS.md — do the next phase."

## If the last phase failed verification
If `VERIFY.md` lists failures (Reviewer or Tester findings), the build is
*mid-phase*, not between phases. Resuming will hand those findings to the
Debugger/Coder to fix first, then re-run Reviewer + Tester, before advancing.
You don't need to do anything special — just resume; the loop handles it.

## Why this works (one line)
Each phase commits + checkpoints before the next begins, so the repo at HEAD is
always resumable and the only thing a pause costs you is the unfinished phase —
which `PROGRESS.md` + `VERIFY.md` tell you how to finish.
