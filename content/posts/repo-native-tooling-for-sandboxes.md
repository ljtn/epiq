---
title: Sandboxes favor repo-native tooling
date: 2026-10-30
tags: ai, agents, security
cover: ./images/repo-native-tooling-for-sandboxes-hero.svg
cover_alt: Three robots at work in a walled sandbox, planning, coding and reviewing; outside, a gatekeeper robot on the phone passes a note into a mailbox inside
guid: https://ljtn.github.io/epiq/blog/repo-native-tooling-for-sandboxes.html
---

Recent incidents [possibly involving rogue agents](https://www.euronews.com/2026/10/14/entire-swedish-reality-show-season-lost-weeks-before-premiere-amid-disputed-ai-claims) highlight the importance of sandboxing. A common setup is a privileged gatekeeper agent on your host machine whose sole responsibility is to delegate work to restricted peers in sandboxed containers.

![The gatekeeper reaches each agent through its own opening in the wall.](./images/sandbox-gatekeeper-simple.svg)

This is not watertight, and as the saying goes: if there is a way in, there is a way out, as we shall see. In any case, it is better than nothing at all, and most importantly, it narrows the contact surface with the outside world.

## It's political

Sandboxing also makes interactions with the agents a pain. Agents without a way to communicate with peers, the gatekeeper, or humans are impractical. The common solution is to relax restrictions with tooling whitelists. This is not only an annoyance from a technical standpoint. In a large corporation, it takes real political skill to navigate security departments and corporate machinery.

## Repo-native tooling

A way around this is _repo-native tooling_ - tools that work offline with only Git access. They have most of the allowances in place, as agents need Git anyway to deliver code.

If, for instance, the agent control plane is part of the repository, we need fewer gates to the outside. We can use Git as a communication transport and a plain log in a repository as memory persistence.

![What crosses the wall is Git, already allowed](./images/sandbox-repo-only.svg)

This simplifies our setup, but there is a problem: our gatekeeper, with access to the outside, can also modify the code. This is a security risk. In fact, the sandbox itself is typically not what fails, but [doors left open on purpose](https://labs.cloudsecurityalliance.org/research/csa-research-note-ai-coding-agent-sandbox-escapes-20260722-c/).

To address this we can separate the control plane into a workflow repo, and give the gatekeeper read-only access to the code.

![A shared workflow repo, and a restricted code repo.](./images/sandbox-repo-native.svg)

## Slipping notes under bars

Repo-native tooling does not address the problem of information flow. An important question is who is reached by what information, with what privileges.

Think of it as a drug lord in prison - the cartel is just as lethal as long as he can slip out notes to someone able to act on them, no matter how restricted he is.

The combination of _private data_, _a way out_, and _untrusted content_ is called [the Lethal Trifecta](https://cosmonic.com/ai-sandbox/principles/lethal-trifecta/).

![Remove one leg, and the lethal trifecta breaks.](./images/lethal-trifecta.svg)

The idea is that we can contain this risk by not giving any agent all three components.

In our setup, the gatekeeper is the only agent that holds all three legs. It has secrets, it has a way out, and it reads untrusted agent notes. As such, we need to make it _human supervised_.

Our current model still carries some risk: should external stakeholders get access to the control plane, their input would reach the agents unfiltered, and vice versa. We can stop our drug lord from slipping notes to the outside by adding a public issue tracker alongside the internal issue tracker:

![One public and one internal issue tracker](./images/sandbox-public-tracker.svg)

## Dead drop
Now the gatekeeper, with no write access to the code, reads instructions from stakeholders and puts notes in the dedicated workflow repo. The notes are picked up by sandboxed agents, with code write access. Think of a Cold War [dead drop](https://en.wikipedia.org/wiki/Dead_drop). In return, sandboxed agents drop notes back onto the workflow repository, leaving an audit trail behind. The gatekeeper reads them as untrusted content.

This is starting to look a whole lot like a setup I am running. For me [Epiq](https://epiq.sh/) is the internal issue tracker and agent memory operating as the _control plane_. It persists an event log in a dedicated repository, tracking work in other repositories, online or offline. It provides a way to peek into the machinery of the sandbox, and I can time-travel via the timeline scrubber and inspect and audit historical workflows.

## Bunch of colored boxes

One question remains: how do sandboxed agents push code or call a model without holding any secrets? Using something like [OpenShell](https://github.com/NVIDIA/OpenShell) to run sandboxed agents, we can keep secrets out of the sandbox entirely, since they are appended by a proxy layer on requests leaving the sandbox.

![A proxy layer appends real secrets outside the sandbox.](./images/sandbox-openshell-setup.svg)

This is a lot of colored boxes, so let's not dive deeper. This should be sufficient to illustrate a basic setup that addresses problems with the lethal trifecta, requiring only: a _Git repo_, _a sandbox_, and _an agent control plane_.

## Conclusion - repo-native is composable and sandboxable
Using tooling that is repo-native, standalone and distributed allows you to compose a range of setups, depending on organizational needs. Epiq can manage one, or both, of the two workflow management planes.

Agentic workflows weren't on the radar at the inception of Epiq, 1.5 years ago, but an append-only event log that lives in the repo and travels over Git turns out to integrate easily with sandboxes, providing a way to coordinate without opening another gap in the wall.

---

Is repo-native tooling a great solution to sandbox restrictions? Do you have a better setup? Share your thoughts in the comments below.
