---
title: In Pursuit of the Ideal Developer Experience
date: 2026-07-03
tags: git, tui, productivity, devex
cover_alt: The epiq board running in a terminal, four columns of issues on a dark ground
devto: https://dev.to/ljtn/in-pursuit-of-the-ideal-developer-experience-2gp8
---

It seemed like the ultimate developer experience - tracking issues in the terminal, editing them the editor of your choice. I contemplated the most appealing alternative workflow I could think of. This was it.

_Epiq is a distributed issue tracker built on top of Git, and this is the story of how it came about._

## Two weeks, at most 

Fingers itched to get started when I pitched the idea to a colleague as we walked down the office corridor, paper coffee cup in hand. My colleague nodded politely, almost as if he too thought it would be cool. No more than two weeks, at most, was my bold prediction.

Now, before judging my poor ability to foresee complexity, the initial scope of the project was quite limited. A rendering engine for the terminal wouldn't be that hard to put together. At some point I would probably need to synchronize state, but surely it could just "synchronize over Git".

Work began the same night. About two hours in I was struck by a moment of unusual clarity and abandoned the idea of creating my own rendering engine. Lo and behold, someone else had already invented the wheel. Enter Ink - a React wrapper that outputs ASCII instead of HTML. A brief moment of sanity had saved me six months, the time plan was within reach, and a few hours later there was a skeleton in place.

## Not the browser

Now I just needed to hook it up to the keyboard, and ... This is where I realized that the terminal is not the browser. In the terminal there is no given way to select anything, let alone navigate via the keyboard, or move things around. “Things” weren’t even a thing. I’d need a node tree representation of the program, somewhat similar to the browser DOM, and a navigation engine to go with it.

Wrote up what seemed like a generic approach to navigation nodes. Tada! - all of a sudden you could select things and traverse the node tree via the keyboard. I was two weeks in, I could see something on the screen, and the original estimate was out the window.

## Calm seas
 
It was time to get the commands in place. Epiq was to have a vim-flavor but with a modern user experience, featuring contextual auto-completions, hints and syntax highlighting. I approached the problem with caution, and wrote a proper engine for the command parsing, mapping and validation. Smooth sailing. Attention shifted to state management.

## Casually walking into Mordor

The project was practically done at this point, and having implemented state management a thousand times before, this was going to be a walk on the beach. It was just a matter of writing the in-memory state to file, perhaps version it, and call it a day. Then it dawned on me that relying on Git for synchronization was going to create the mother of all merge conflicts - all the time.

Aha, thought I. I could just split up the state in fine granular, versioned pieces, one file per version. Then, came the next realization - ordered children. This meant arrays, and concurrent edits to the same array meant … merge conflicts.

To my delight at this point I learned of the esoteric technique of fractional indexing, after counseling sessions with an LLM. The idea behind fractional indexing is to assign certain ranks by halving in an absurdly vast number space (shout out to BigInts). Re-ordering was but a single node edit.

Then it dawned upon me that even now you could get concurrent edits to the same index. I set out to explore an array of alternative approaches. Even encoding ranks in file- and folder names, renaming files instead of co-editing the same file (it actually works!). Eventually I came across a solution that reliably avoided merge conflicts, but quickly noticed unreasonable amounts of claimed disk space. Extreme normalization meant thousands of tiny files, and as files claim a larger block of “growing space” than they initially need, even a fairly small board would claim megabytes of disk space.

## The big rewrite

**This wasn't going to convince the nerds**, and I imagined only nerds would actually care for this project. About seven months into the project it slowly dawned upon me that the persistence paradigm I was trying to shoehorn in was a bad fit.

For some time the idea of event sourced state had appeared on my radar as a viable path forward, but I could never muster the courage to think about it, as it meant a full rewrite. After trying almost every other trick in the book, I allowed myself to think about it a little more. If state could be represented as append-only entries to user-scoped event-logs, all merge fears could be buried forever. That is when I decided to throw away the entire persistence layer, months of work, and a solution that actually worked - betting everything on event-sourcing.

Six weeks later the event-sourced state engine fired up for the first time. To my amazement, it worked! Or, it seemed to work, at first. Then I was struck by the realization that multiple concurrent users were destined to break the model. Without a central broker Epiq was relying heavily on ULIDs, (time encoded ids) for harmonizing user logs into a shared authoritative log. A user with a clock drifting ever so slightly would risk messing up the order, fatally corrupting materialization, with ever accelerating drift.

## Clock Drift

The solution to this problem arrived in the car (a 2009 Hyundai i20, for reference) during an 11h road trip to northern Sweden. I realized that entry ids had to be a composite - an id plus a reference to the last known “edge”. Only in the case of multiple entries pointing to the same edge would time resolve order, now contained and with non-fatal consequences as there would be a common understanding of the world.

Put it to the test as soon as the road trip was over, and - it worked. This, I later learned, is a very old idea in distributed systems: when clocks cannot be trusted, you stop reasoning about physical time and instead reason about causality. Leslie Lamport has written about this in his 1978 paper _Time, Clocks, and the Ordering of Events in a Distributed System_.

## Succeed or fail

It was becoming increasingly evident that resilience was of utmost importance in a distributed system. TypeScript, however, was lacking in strictness as function signatures don’t express possible exceptions by default. This led me to introduce a custom result type - a union of success and failure states, forcing me to consider every error path at all times. This turned out to be a distinct leap in terms of the reliability and traceability of the system. Shout out to _Effect_ - which inspired this design choice.

## Git doing its thing

Nine months in, and the actual state sync would just be a minor detail before going live. Just had to write the event log to file on the checked-out branch and have Git do its thing. By now it may not come as a surprise that this turned out to be another rabbit hole, or shall we say, _another rabbit mining shaft_?

My initial approach of persisting the logs to the checked-out branch and merging occasionally, turned out to be the equivalent of trying to hold a conversation in the subway with a person on a different train, going the other direction. Rewrote the synchronization layer multiple times. Epiq needed a single source of truth, but how to achieve it remained a mystery. Many rewrites later it appeared that it just wasn't possible to achieve multi-user concurrent edits, using Git as a backend.

Then I discovered Git worktrees, a Git feature escaping my attention for the longest. To my amazement Epiq could have multiple branches checked out simultaneously and persist state in a shared, dedicated state branch while the user worked in another! One final rewrite later, at the end of the rope, I put it to the test, and… It worked - _beautifully_. Multiple clients making concurrent edits as if this was the ordinary state of the world. Over Git. In the terminal. No central broker.

My mind was blown. About a year after that conversation in the corridor, paper coffee cup in hand, what started off as an idea was now an actual thing that you could interact with.


## Ignore the invitation

In hindsight, the initial vision and implicit constraints paved the way for an interesting architecture. It made Epiq vendor agnostic, terminal-first, offline-first, and gave it a traceable, replayable state (yup, there is a command for replaying your board history like a movie).

For every solved problem there is a pile of failed attempts, for every failed attempt there is an invitation to give up, or worse - compromise.

A compromise often gets you to the finish line twice as fast, but the destination is rarely half as interesting.

---

_If you're curious, Epiq can be seen at: https://ljtn.github.io/epiq/_

---

_Editor's note: Epiq finally launched on HN May 16, trending on the front page for more than 24h. Since then Epiq has been equipped with two of most requested features - a single binary and an optional browser GUI._
