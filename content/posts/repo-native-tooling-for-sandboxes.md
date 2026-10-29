---
title: Repo native tooling simplifies sandboxes
date: 2026-10-29
tags: ai, agents, security
draft: true
---

Recent incidents involving [rogue agents](https://www.tv4.se/artikel/2iwfK5MNpFID98pxQbsC7t/hel-saesong-av-tv4-programmet-raderat-av-ai) have highlighted the importance of sandboxing. A common setup is a privileged gatekeeper agent on your host machine whose sole responsibility is to delegate work to restricted peers in sandboxed containers.

![Every interaction with the gatekeeper is an opening in the wall.](./images/sandbox-gatekeeper-simple.svg)

This is not watertight, and as the saying goes: if there is a way in, there is a way out, as we shall soon see. In any case, it is better than nothing at all, and most importantly it narrows the contact surface with the outside world.

## It's political

What it also does is make your interactions with the sandboxed agents a pain. Agents without a way to communicate with peers, the gatekeeper, or humans are impractical. The standard way is to relax restrictions with tooling whitelists. This is not only an annoyance from a technical standpoint. In a large corporation, it takes real political skill to navigate security departments and corporate machinery.

## Repo native tooling

A way around this is repo native tooling. Tools that work offline, only needing Git access, have most of the allowances in place, as agents need Git anyway to deliver code.

If, for instance, the control plane is part of the repository, we need fewer gates to the outside. We can use Git as a communication transport and a plain log in a repository as memory persistence. [Epiq](https://ljtn.github.io/epiq/) is an issue tracker and workflow manager doing just that.

![What crosses the wall is Git, already allowed](./images/sandbox-repo-native.svg)

## Trusted channels are soft spots

Now, the sandbox itself is typically not what fails, but the doors left open on purpose. This is called the [trust handoff](https://labs.cloudsecurityalliance.org/research/csa-research-note-ai-coding-agent-sandbox-escapes-20260722-c/): the agent stays inside the box but something trusted, outside the box, runs what it wrote. Think of it as a drug lord in prison - the cartel is just as lethal as long as he can slip out notes to someone who can act on them, no matter how restricted he is.

Just using Git narrows the contact surface with the outside, but it does not limit information flow. The question is who is reached by what information, and with what privileges.

## The Lethal Trifecta

The consensus approach is to break the circuit of [the Lethal Trifecta](https://cosmonic.com/ai-sandbox/principles/lethal-trifecta/) by cutting off at least one of its three legs (private data, a way out, and untrusted content) for every individual agent.

![Only where all three meet is an agent lethal. Remove one, and the circuit breaks.](./images/lethal-trifecta.svg)

Sandboxed agents never hold private data. Using tools like [OpenShell](https://github.com/NVIDIA/OpenShell) to orchestrate our sandboxes, we can keep secrets out of the sandbox entirely, since they are appended by a proxy layer on requests leaving the sandbox.

The gatekeeper is another matter: it holds secrets, has a way out, and reads what sandboxed agents write. So it is supervised by a human, runs in manual mode and never executes commands.

## Dead drop

Separating the workflow repo from the code repos keeps the sandbox's code away from host writes, and Epiq supports it.

An agent on the host never talks directly to sandboxed agents, and has no write access to code repositories, but puts notes in the dedicated workflow repo. The notes are picked up by sandboxed agents, with access to the code repositories. Think of a Cold War [dead drop](https://en.wikipedia.org/wiki/Dead_drop). In return, they drop notes back onto the workflow repository, read as untrusted content, leaving an audit trail behind.

With our setup we can restrict our sandboxed agents to fewer ways out and no access to secrets, and our gatekeeper to no code write access. Additionally the trail enables observability of the information flow. Every note is a log event, and the board can be replayed to any point in time. Should something drift, you can pin down exactly where the drift started, and by whom.

Since agents can write to the workflow repo, protect its branch against force-pushes and deletion.

## Bare clones

Git itself can be used in clever ways by attackers. [GitSpawn](https://adversa.ai/blog/top-ai-coding-agent-security-resources-october-2026/) used repository config to run code whenever Git was called.

In Epiq, when the host links the code repo, it reads it through a shallow, bare clone: no working tree, nothing checked out, hooks and `.gitattributes` switched off. Git only ever transfers content, never settings or hooks, and the host never checks that content out. So nothing the sandbox writes can make the host run anything. The handoff happens only as data.

## A recent setup
A setup I am currently running looks something like this:

![The proxy appends real secrets per binary, host and path.](./images/sandbox-openshell-setup.svg)

I use [OpenShell](https://github.com/NVIDIA/OpenShell) for sandboxing agents, and Epiq as the control plane in a separate repository. Epiq provides a way for agents to interact in a traceable way, with passive data, and it also provides an easy-to-navigate interface to audit agent interactions.

Since the communication in this setup is passive (text rather than executed commands), one could add a layer of auditing agents without access before it is handed over to agents with privileges.

## Composable, sandboxable
Building blocks that are repo native, standalone and distributed allow you to compose a great variety of setups, depending on organizational needs. Epiq can be used as an agent memory graph, a workflow manager, an audit trail, or all at once.

---

Do you agree with the sentiments expressed, or is this nothing but mumbo jumbo? Leave a comment and share your thoughts below, I'd love to hear 'em!
