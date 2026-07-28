# Third-Party Notices

Cash Cage builds on the following open-source projects. None are vendored into
this repository — the C++ backend resolves them at build time via CMake
(`find_package` for OR-Tools, `FetchContent` for the rest), and the mobile app
resolves its dependencies via npm.

This file is provided as a courtesy to readers of this repository, not a legal
discharge. Each project's license text is published with that project, at the
links below.

## Backend (C++)

| Project | Version | License |
| --- | --- | --- |
| [Google OR-Tools](https://github.com/google/or-tools) | resolved via `find_package` | Apache-2.0 |
| [aws-lambda-cpp](https://github.com/awslabs/aws-lambda-cpp) | v0.2.8 | Apache-2.0 |
| [Crow](https://github.com/CrowCpp/Crow) | v1.2.0 | BSD-3-Clause |
| [nlohmann/json](https://github.com/nlohmann/json) | v3.11.3 | MIT |

Crow is copyright 2014-2017 ipkn and 2020-2022 CrowCpp. aws-lambda-cpp is only
fetched at v0.2.8 when the build doesn't find a system install already
providing it.

## Frontend

The mobile app is built with React Native, Expo, Firebase, and RevenueCat.
Their licenses are declared in `frontend/package-lock.json` and reproduced in
each package's distribution.
