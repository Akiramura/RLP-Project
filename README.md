RLP — League of Legends Analytics

A desktop application built with Tauri (Rust + React) that integrates directly with the League of Legends client to streamline pre-game preparation and post-game analysis.


Features
Auto Import (Champion Select)
Detects when the user enters champion select and automatically fetches and imports the optimal runes, summoner spells, and item sets for the selected champion and assigned role — directly into the League of Legends client. No more manual rune configuration or mid-lobby build lookups.
Player Profile
Displays summoner information including level, XP progress, Ranked Solo/Duo and Ranked Flex standings (tier, LP, win rate, games played), top champions by games played, and average performance statistics (KDA) computed from recent match history.
Match History
Paginated view of recent matches. Each entry shows champion played, KDA, CS, vision score, gold earned, items purchased, game duration, and outcome. Supports searching and viewing profiles of other summoners.
Champion Stats
Analyzes personal match history to surface per-champion performance breakdowns — helping players identify which champions they perform best on and where to improve.
Tier List
Current champion tier list based on live meta data, organized by role, to support informed champion selection decisions.

Platform
Desktop (Windows) — built with Tauri 2.0 (Rust backend, React frontend)

APIs Used
APIPurposeRiot Summoner APISummoner profile (level, icon, gameName, tagLine)Riot League APIRanked stats (tier, rank, LP, wins, losses) for Solo/Duo and FlexRiot Match APIMatch history and detailed per-game statisticsLCU (League Client Update) APIDetect champion select, read position and champion, import runes and summoner spells into the client

Installation
Download the latest .msi installer from the Releases page and run it.
Updates are delivered automatically — when a new version is available, the app will prompt you to update on launch.

Intellectual Property
Copyright
© 2026 Akiramura. All rights reserved.
The source code, architecture, design, and all original components of RLP are the exclusive intellectual property of the author. Unauthorized copying, distribution, modification, or use of any part of this software — in whole or in part — without explicit written permission from the author is strictly prohibited.
Trademark
The name RLP and its associated logo are proprietary identifiers of this project. Use of the name or logo in any form — including forks, derivative works, or third-party distributions — is not permitted without explicit written authorization from the author.

Legal Notice
RLP Project was created under Riot Games' "Legal Jibber Jabber" policy using assets owned by Riot Games. Riot Games does not endorse or sponsor this project.

Riot Games, League of Legends, and all associated properties are trademarks or registered trademarks of Riot Games, Inc. This application uses the Riot Games API and the League Client Update (LCU) API in accordance with Riot Games' Developer Policies.

Build and meta data are sourced from the OP.GG MCP API (github.com/opgginc/opgg-mcp), an official public API published by OP.GG Inc. under the MIT license. RLP Project is not affiliated with or endorsed by OP.GG Inc.

Auto-Updater
RLP includes a built-in auto-updater powered by tauri-plugin-updater. On each launch, the app checks for new releases. If an update is available, you will be prompted to install it automatically.