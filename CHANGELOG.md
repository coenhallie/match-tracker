# Changelog

What changes for someone watching the tracker, release by release. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions
follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0]

The release date is set when 0.1.0 is tagged.

The first release: video-annotation's 2D replay as a widget of its own, for
this site's live matches and, next, for video-annotation itself.

### What you see

- The pitch, players and ball as the tracking data has them, in fixed colours:
  - home red and away blue;
  - goalkeepers yellow, ringed in their team's colour;
  - officials black.
- The moments, as in video-annotation:
  - a goal: the camera follows the shot into the net, then the GOAL card shows;
  - an attack: the attacking team's half is shaded, with its name;
  - a free kick: its banner stays up while play is stopped;
  - a throw-in: its banner slides in from the ball's side.
- The ball's trail, rings round the players near the ball, and distant players faded.
- Above the pitch, which team is attacking and which is defending.
- A layers menu to switch each of these on or off. Your choice is remembered.
- English or Chinese text. Chinese uses your system's Chinese font, and every
  label fits its card or row, down to a 320 px wide phone.

### What is new compared with video-annotation

- The page scrolls under a plain mouse wheel. Hold Ctrl or ⌘ to zoom, or pinch
  on a trackpad or touch screen. Double-click to reset.
- Live matches: frames are drawn as they arrive. A hidden tab or a widget
  scrolled out of view stops drawing, and catches up when you come back.
- The layers menu closes with Escape only while you are using it.
- Long team names are cut short with "…". The full name is in the tooltip.

### Size and speed

Measured on an Apple M4 Pro laptop, in headless Chrome 156 with GPU canvas
(Metal), at 1280×720 CSS px and a pixel ratio of 2 (a 2560×1440 bitmap):

- **Download:**
  - the widget is 31.6 kB gzipped (budget 60 kB);
  - the Vue component adds 0.7 kB;
  - the fonts are 81.7 kB, fetched once.
- **Drawing one frame:**
  - 0.16 ms on average over the 193 frames of a goal, drawn 5 times;
  - 0.6 ms at the 95th percentile, and 2.3 ms at most (target: under 4 ms);
  - 0.20 ms per frame when the GPU work is included.
- **A whole animation frame during a goal** (the replay's update and the
  draw): 1.0 ms on average and 2.2 ms at most.
- **On a phone profile** (375 px wide at a pixel ratio of 3, CPU slowed 4×),
  during a goal:
  - an animation frame takes 1.3 ms on average and 2.9 ms at most, against
    16.7 ms for 60 frames a second;
  - no frame was dropped. Headless Chrome shows 30 frames a second, and no gap
    between frames was longer than one of them (33.4 ms at most). The
    performance trace reports no dropped frame.
- **With the CPU slowed 4× at 1280×720 at 2x:** drawing one frame takes
  0.53 ms on average. 28 of 964 draws took between 4 and 6.5 ms.
