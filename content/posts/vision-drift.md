---
title: Vision drift: workflow replay to the rescue
date: 2026-07-15
tags: ai, agents, productivity, tui
cover_alt: The epiq board running in a terminal, four columns of issues on a dark ground
devto: https://dev.to/ljtn/vision-drift-addressing-the-next-problem-in-agentic-workflows-2gfb
---

Harness engineering has recently popularized the idea of containing **_architectural drift_** in agentic workflows. What might be missing in the discussion is a similar issue on a higher level - **_vision drift_**.

By vision drift I mean that the implementation no longer drifts only from the architecture - it drifts from the original product intent. This could happen as a result of agents administrating their own work unsupervised for too long. And it seems like restricted project management tooling is a risk. As long as issue trackers only present a static snapshot of the workflow rather than a traceable, repeatable story, drift may go unnoticed.

While Git solves this for code, issue trackers essentially lacks this capability, and while excellent at answering the question “what's going on right now?”, they fail at answering the question “how did our work in this area evolve last month?” or “what went on this time last year?”, or “how did we get from there to there?”.

## Workflow audits

When I set off to build [Epiq](https://ljtn.github.io/epiq/), this was not a concern on my radar. Agentic coding was something I had heard distant rumors of, and in fact I was just [pursuing the ideal developer experience](https://dev.to/ljtn/in-pursuit-of-the-ideal-developer-experience-2gp8). This pursuit did however result in an issue tracker with some uncommon properties. One of these is the ability to inspect historical state by time-traveling, and replay historical board states.


Initially I thought of it as a gimmick feature, imagining the wow-factor of replaying board layout the past 2 weeks as a little movie. I thought it would help out with retros and reflection of how much (or little) work had been accomplished. Not until I set out to run my first fully autonomous agent workflow did I notice how board time-travel was going to be an essential feature for anyone serious about staying in control.

## Questions raised

It went like this: I had made a master plan together with Claude, and asked it to administrate the plan execution and breakdown using Epiq. As I returned two hours after it set off I was delighted to see that all of the issues had moved across the board to the review column. I spent an hour or two reviewing the code. It all looked great. All solid, tested and well functioning code, following existing architectural patterns in the codebase. Only, now I was incredibly interested in how the work had elapsed. I addition to what could be inferred from the code, I found myself asking:

- How did we get here?
- Had any new tickets been created not anticipated initially?
- Has the plan been revised?
- Had any other issues on the board been blockers?

A single agent working independently for two hours already left me wondering how the implementation evolved. I asked myself what happens when twenty agents collaborate over three days.

How was the work coordinated?
Had they wastefully worked against each other, or in harmony, building on each other's work?
Most importantly - had they abandoned, or revised the initial vision?

I could see how a snapshot state of the board no longer satisfied these questions, and unless you sat and monitored the board evolution in real time you would be unequipped to answer them.

## The full story

Luckily, with Epiq, this was but a single command away: “:replay 2h”. That was all it took for me to see the whole session replayed as a time-lapsed movie. It dawned upon me that Epiq, with its persistence model, accidentally offered powerful functionality that will be required for humans to stay in charge of the vision.

## The future of project management tooling

It seems like agentic coding isn’t going to go away any time soon. And given that we do some course corrections in our methodology after the initial hype I can see its given place even in serious productions, given that we reserve for humans the ability to stay in the loop - in charge.

With agents getting more and more autonomy, the risk of potential vision drift calls for better workflow auditing. Just one step up from architectural audits it seems like the natural next step in the discussion surrounding agentic workflows.

Git made the evolution of source code inspectable. I believe the next generation of project management tooling will need to make the evolution of intent inspectable.


_In case you are interested 👉 [Explore Epiq](https://ljtn.github.io/epiq/)_
