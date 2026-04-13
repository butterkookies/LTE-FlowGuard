post by ericli on Apr 1
post by Russell_S on Apr 2
post by Russell_S on Apr 2

Russell_S
12d
addendum… one more tweak

Still happening — 13:54:12 shows the same error. The language server has its own embedded git that’s not reading our fix. Let me check if Antigravity bundles its own git binary.

Ran 3 commands

Ran 3 commands

The fix is in the config but the error persists. The [lfs] section has a second repositoryformatversion = 0 — the Go git library might be reading that one instead. Let me check the full config.

Read 2 files

Read 2 files

The Go-based language server might be confused by the [lfs] repositoryformatversion = 0 line, or it might just be that worktreeConfig itself is the problem for this Go git library regardless of format version. Let me try the other fix from the forum — just remove the worktreeConfig extension entirely. Claude Code worktrees will still work (git added that config automatically).

Ran 2 commands

Ran 2 commands

Also remove the stale [lfs] repositoryformatversion that shouldn’t be there:

Remove stale lfs section

Remove stale lfs section

Let me verify the config is clean now:

Ran 2 commands

Ran 2 commands

Repo 1 has the same double-version issue. Let me check and clean it:

Ran 2 commands, read a file

Ran 2 commands, read a file

Both repos are now clean. Now fully quit and restart Antigravity again. The key change this time is


post by whafa on Apr 2

whafa

Neo_Wang
11d
This is incredible. Claude confirmed and fixed this issue for me now, too.

I’ve noticed lately that the biggest bottleneck in my own progress is often the amount of time it takes me to realize I can ask Claude to look at this.

Maybe Google should be using Claude Code to develop Antigravity :smiley:


post by Aman_Panda on Apr 2

Aman_Panda
11d
It turns out this wasn’t an AI model problem at all, but a repo-discovery failure. Because Antigravity is designed as an agentic platform that needs to understand your entire workspace to function, the whole pipeline stalls if its internal Git parser can’t resolve your repository metadata. In my case, the repo had the worktreeConfig extension enabled, which triggered a compatibility error because the platform’s parser didn’t support that specific Git extension.

The fix was to remove the extensions.worktreeConfig entry and run a prune to clean up stale metadata, reverting the repo to a standard format. The main trade-off is that I lost the ability to have unique Git settings for individual worktrees, though the worktrees themselves still function normally for standard development. If you’re seeing silent failures, it’s likely your repo metadata is confusing the workspace resolution logic.

For more context, the Google AI 2025 announcements explain Antigravity’s architecture as an agent-first platform that requires successful repository mapping to initiate tasks. You can also find technical details in the official Git documentation, which explains why certain parsers refuse the worktreeConfig extension to maintain compatibility with older repository formats.