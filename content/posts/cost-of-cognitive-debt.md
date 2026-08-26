---
title: Cost of Cognitive Debt
date: 2026-08-25
tags: ai, architecture, ddd, programming
cover_alt: A wide, dark abstract banner
devto: https://dev.to/ljtn/ccd-cost-of-cognitive-debt-a47
---

It is easy to end up in one of two absolutes: either AI is the future and traditional coding is dead, or, agentic workflows are non-deterministic with no place in modern software development. However, there may be a third way, one that recognizes the problems, and addresses the risk in a methodical way.

I'd like to introduce you to Cognitive Debt - the condition of nobody understanding a part of your system - and to the Cost of Cognitive Debt, or CCD, an estimation of what that condition costs in reality.

## Accumulating unknown unknowns

It makes sense that not understanding the inner workings of a system that a company strategy relies on has real-world costs. You would, for instance, be unable to create a plan for overtaking your competitors without understanding your own technical limitations and advantages.

Parts of a system not understood by humans could be thought of as subject to Cognitive Debt, distinct from technical debt. Where technical debt describes understood technical problems within a system - Cognitive Debt describes the fact that you don't even understand if you have a problem, and consequently there is no solution either.

This is not a new observation. It has long been understood that a program is not limited to its source code but a theory held in the minds of the people who built it. Lose the people and you have lost the reason for why the program exists at all, even though it still compiles. What agentic workflows change is that we can now produce code that never had a theory behind it to begin with.

It is reasonable to assume that Cognitive Debt eventually can lead to Cognitive Meltdown - a state where no human is able to build a mechanical intuition for how a system works given any reasonable amount of time. This would hence render the system useless from a business point of view, while the cost of recovering insight would outweigh any potential gains.

## Putting a number on it

To make sense of this we would be helped by a method. I suggest scoring each part of the system from 1 to 10 on three questions:

| Factor         | 1 (good)                                 | 10 (bad)                            |
| -------------- | ---------------------------------------- | ----------------------------------- |
| Severity       | Non-critical parts                       | Concerns business, money, or safety |
| Opacity        | Multiple people can explain it           | No human understands it             |
| Recoverability | The original context is easily recovered | Context is forever lost             |

The CCD of a part of the system is roughly the worst of the three, not the average. A module that is trivially recoverable is still dangerous if it silently harms your customers.

The point of the score is not precision. It is to force the conversation to happen per domain, and to happen before the debt is taken on rather than after a meltdown.

## The things we must understand

Now, given that we have encapsulated our system into separate domains, or a layered architecture, we can address this problem with some granularity.

It seems natural that the core business rules of a system need to be well understood by not just developers, but by leadership and stakeholders as well, and this should result in a conservative view of what parts of the system we can expose to agentic workflows, and to the risk of Cognitive Debt.

For instance, we would be wise not to introduce unattended agentic workflows in layers of a system that are concerned with critical business rules. This part of the system would score a 10.

It also seems obvious that any infrastructure layer that could bring the system down for any period of time would have to be overseen and understood by humans. These parts of the system would score a high CCD value as well.

So far I agree with the zero-agentic AI perspective.

## Where we can accept loss

But, below these levels of system architecture, the impact of Cognitive Debt may become a little more contained, given a modular architecture. Inside of a non-critical domain, within a contained blast radius, we could allow ourselves to accumulate some Cognitive Debt, as long as the cost thereof would be outweighed by potential gains.

There is still a risk, but it is contained. We could still have a Cognitive Meltdown within this scoped context, but not all domains are equally essential for the system fulfilling its purpose, so we could make a risk assessment and accept this Cost of Cognitive Debt.

![The top of the stack stays human. The contained domains below are where debt can be taken on deliberately.](./images/ccd-by-layer.svg)

Modularity is what makes Cognitive Debt survivable, but it is not a hard boundary, and loss of insight may have cascading effects.

## Paying it back

Now, in finance, debt is something that you are expected to eventually pay back. If we are to introduce the idea of calculated acceptance of Cognitive Debt, it makes sense to plan for how to get out of the debt. No one in their right mind would borrow more than they are theoretically able to pay back.

Repayment here means a human rebuilding the theory, reshaping it into something a person can hold in their head, and building mechanical intuition for how it behaves.

We can extend the metaphor by introducing interest. The cost of repayment is not constant, it grows. Every month the code drifts further from anybody's mental model, the people who held the surrounding context move on, and incorrect assumptions are hardened into surrounding code. Debt you meant to repay next quarter is more expensive next quarter than it is today.

![The gap between what you set aside and what it now costs is the interest.](./images/ccd-interest.svg)

Agentic workflows are here to stay and we need a framework for reasoning in a methodical way about non-deterministic workflows in products that entire businesses rely heavily on. In the past leadership and stakeholders were oblivious to the risks and impact of architectural decisions, relying heavily on responsible technical experts, who often saved the product by understanding the business needs. Now that many technical experts have resigned themselves to the same state of delightful ignorance, we need to address this in a structured way.

Is this a reasonable way of addressing and reasoning about the risk introduced by agentic workflows? I would like to hear where it breaks - [start a discussion on GitHub](https://github.com/ljtn/epiq/discussions) and let me know your thoughts.
