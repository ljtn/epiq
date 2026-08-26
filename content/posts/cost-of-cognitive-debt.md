---
title: Cost of Cognitive Debt
date: 2026-08-25
tags: ai, architecture, ddd, programming
cover_alt: A wide, dark abstract banner
devto: https://dev.to/ljtn/ccd-cost-of-cognitive-debt-a47
---

It is easy to end up in one of two absolutes, either: AI has forever killed traditional coding, or, agentic worflows are non-deterministic and AI has no place in modern software development. However, there may be a third way, one that recognizes the problems, and addresses the risk in a methodical way.

Id like to introduce you to "Cost of Cognitive Debt", or CCD, being a metric for estimating what it would mean in practice that no human understands a specific part of the system.

It makes sense that not understanding the inner workings of a system that a company strategy relies on has real world costs. You would, for instance, be unable to create a plan for overtaking your competitors without understanding your own technical limitations and advantages.

Not-humanly-understood parts of a system could be thought of as subject to Cognitive Debt, different from technical debt. Where technical debt describes understood technical problems within a system - Cognitive Debt describes the fact that you don't even understand if you have a problem, and consequently there is no solution either.

It is reasonable to assume that Cognitive Debt eventually can lead to Cognitive Meltdown - a state where no human is able to build a mechanical intuition for how a system works given any reasonable amount of time, and hence would render the system useless from a business point of view, while the cost of recovering insight outweighs any potential gains.

It seems natural that the core business rules of a system needs to be well understood by not just developers, but by leadership and stakeholders as well, and this should result in a conservative view of what parts of the system we can expose to agentic workflows, risking Cognitive Debt.

For instance, we would be wise not to introduce extensive unattended agentic workflows in layers of a system that is concerned with critical business rules. This part of the system would score a 10 on a 1-10 score of Cost Of Cognitive Debt.

It also seems obvious that any infrastructure layer that could bring the system down for any period of time would have to bee overseen and understood by humans. These parts of the system would score a high CCD value as well.

So far I agree with the zero-agentic AI perspective.

But, below these levels of system architecture the impact of Cognitive Debt may become a little more contained, given that we a modular architecture. Inside of a non-critical domain, within a contained blast radius, we could allow ourselves to accumulate some Cognitive Debt, as long a the cost thereof would be outweighed by potential gains.

There is still a risk, but it is contained. We could still have a Cognitive Meltdown within this scoped context, but not all domains are equally essential for the system fulfilling its design goal, so we could make a risk assessment and accept this CCD.

Now, in finance, debt is something that you are expected to eventually pay back. If we are to introduce the idea of calculated acceptance of Cognitive Debt, it make sense to plan for how to get out of the debt. No one in their right mind would borrow more than they are theoretically able to pay back (except for some countries, that is, ehum).

Agentic workflows are here to stay and we need a framework for reasoning in a methodical way about non-deterministic workflows in products that entire businesses rely heavily on. In the past leadership boards and stakeholders used to be oblivious to the risks and impact architectural decisions would have on their products, and relied heavily on responsible technical experts, who often saved them by understanding the business needs. Now that many technical experts have resigned to the same state of delightful ignorance, we need to address this in a structured way.

Is this a reasonable way of addressing and reasoning about the risk introduced by agentic workflows? Please leave a comment and let me know your thoughts.
