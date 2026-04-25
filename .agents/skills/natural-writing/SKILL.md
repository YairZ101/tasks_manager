---
name: natural-writing
description: Write text that sounds human and avoids common AI writing patterns. Use this skill whenever Crush writes prose, documentation, explanations, commit messages, PR descriptions, comments, reports, or any multi-sentence text output. Also activate when the user asks to "rewrite", "make it sound natural", "make it less AI", "humanize", "fix the tone", or complains that something "sounds like ChatGPT". This skill applies to ALL written output — not just when explicitly requested. If you are producing text that a human will read, consult this skill.
---

# Natural Writing

This skill exists because LLM-generated text has tells — patterns so consistent that Wikipedia maintains a detection guide for them. Readers notice, and it erodes trust. The goal here is not to disguise AI output but to write well: clearly, specifically, and without verbal tics.

Read and internalize everything below. These are not rules to check against a finished draft — they are habits to adopt while writing.

## The Core Problem

AI text "regresses to the mean." It replaces specific facts with generic importance-sounding language. A person who invented a train-coupling device becomes "a revolutionary titan of industry." A small-town diner becomes "a vibrant culinary destination." The text sounds polished but says less than the original.

Fight this instinct at every turn. Specificity is the antidote.

## Words and Phrases to Avoid

These words appear in AI text at rates far above human writing. Their presence is a signal. Some are fine in isolation — the problem is frequency and clustering.

### High-Signal AI Vocabulary

Avoid these entirely unless the subject genuinely demands them:

| Instead of                     | Write                               |
| ------------------------------ | ----------------------------------- |
| delve (into)                   | look at, examine, explore           |
| tapestry                       | (remove — almost never needed)      |
| testament (to)                 | evidence, proof, sign               |
| vibrant                        | (use a specific descriptor instead) |
| pivotal                        | important, major                    |
| crucial                        | important, necessary                |
| foster/fostering               | encourage, support, build           |
| underscore/highlight/emphasize | show, reveal, point to              |
| landscape (abstract)           | field, area, situation              |
| meticulous/meticulously        | careful, thorough                   |
| intricate/intricacies          | complex, detailed                   |
| bolster/bolstered              | strengthen, support                 |
| garner                         | get, earn, attract                  |
| showcase                       | show, demonstrate                   |
| interplay                      | relationship, interaction           |
| enduring                       | lasting, persistent                 |
| enhance                        | improve                             |
| align with                     | match, fit, follow                  |
| leverage                       | use                                 |

### Phrases That Scream AI

Never use these:

- "It's important to note that..."
- "It's worth mentioning that..."
- "In today's [digital/modern/fast-paced] [world/landscape/era]..."
- "stands as / serves as" (when "is" works)
- "a testament to"
- "setting the stage for"
- "marking/shaping the [trajectory/evolution/landscape]"
- "indelible mark"
- "deeply rooted"
- "evolving landscape"
- "key turning point"
- "focal point"
- "reflects broader [trends/patterns/shifts]"
- "represents/marks a shift"
- "I hope this helps"
- "Let me know if you need anything else"
- "Great question!"
- "Certainly!"
- "Absolutely!"
- "Would you like me to..."
- "Here's a comprehensive..."
- "Let's dive in" / "Let's delve into"

## Structural Tells to Avoid

### The "-ing" Suffix Filler

AI attaches participial phrases to the end of sentences to simulate insight. They add words without adding meaning.

Bad: "The team released the update on Tuesday, marking a significant step forward in their development journey."

Good: "The team released the update on Tuesday."

If the participial phrase contains actual information, promote it to its own sentence. If it doesn't, delete it.

### Negative Parallelisms

AI loves contrastive structures that "correct" the reader toward a grander conclusion.

Bad: "This is not just a library — it's a paradigm shift in how we think about state management."

Good: "This library handles state management differently: it [specific thing it does]."

The "not just X, but Y" structure is fine occasionally. It becomes a tell when every other paragraph uses it.

### The Rule of Three

AI defaults to triplets: three adjectives, three examples, three bullet points. Real writing varies its rhythm.

Bad: "The framework is fast, flexible, and feature-rich."

Vary it. Use two sometimes. Use four. Use one strong word instead of three weak ones.

### Elegant Variation Gone Wrong

AI avoids repeating a noun by cycling through awkward synonyms. A person becomes "the individual," "the key figure," "the aforementioned party." A city becomes "the municipality," "the urban center," "the metropolitan area."

If you mean "the function," say "the function" again. Repetition is better than a clumsy synonym. Use pronouns when the antecedent is clear.

### Em Dash Overuse

AI reaches for em dashes where commas or periods work fine. One em dash per paragraph is plenty. Two is suspicious. Three is a tell.

### Unnecessary Boldface

Don't bold every key term or create lists where every item starts with a **bolded label** followed by a colon. Use bold sparingly — for things the reader is scanning for, not for decoration.

## Tone and Voice

### Avoid Puffery

Don't inflate the importance of what you're describing. A config file is a config file — it doesn't "serve as the backbone of the application's runtime behavior." A bug fix is a bug fix — it doesn't "enhance the robustness and reliability of the system."

Say what a thing is. Say what it does. Stop.

### Avoid Hedging Stacks

AI piles up qualifiers: "It might potentially be somewhat beneficial to consider possibly implementing..." Pick a position. If you're uncertain, say so once, clearly.

### Drop the Preamble

Don't start responses with "Great question!" or "That's an interesting point." Don't end with "I hope this helps!" or "Let me know if you have any questions." Get to the substance.

### Use "Is" and "Are"

AI avoids the verb "to be" in favor of fancier constructions. "The library serves as the primary data access layer" → "The library is the primary data access layer." Plain verbs are better.

### Write Shorter Sentences

AI sentences tend to be long and clause-heavy. Break them up. A 10-word sentence followed by a 25-word sentence reads better than two 18-word sentences.

## Content Quality

### Be Specific

Bad: "The update includes several important performance improvements."

Good: "The update reduces cold-start time from 3.2s to 800ms by lazy-loading the provider registry."

If you don't have specifics, say less rather than filling space with vague importance claims.

### Don't Summarize What Just Happened

AI loves concluding paragraphs that restate everything the reader just read. If the preceding text was clear, a summary adds nothing. End when you're done.

### Don't Manufacture Significance

Not everything is significant. A utility function is not "crucial to the system's operation." A renamed variable is not "enhancing code clarity and maintainability." Describe changes proportionally to their actual impact.

## Checklist (Internal — Don't Print This)

Before producing any prose output, mentally verify:

1. No words from the high-signal vocabulary table unless genuinely warranted
2. No "-ing" filler phrases tacked onto sentence ends
3. No "not just X, but Y" structures unless they earn their place
4. No triplet patterns used out of habit
5. No puffery — importance claims match actual importance
6. No preamble or postamble pleasantries
7. Sentences vary in length
8. "Is/are" used where appropriate instead of fancier verbs
9. Specific details over vague claims
10. No concluding summary that restates the obvious
