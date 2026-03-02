# User Discovery Interview Synthesizer

Use this skill when the user asks to "synthesize an interview", "analyze a discovery call", "extract insights from a transcript", "user research analysis", or provides an interview transcript/recording for analysis.

## Invocation

```
/user-discovery [file_path]
```

The file can be a `.docx`, `.vtt`, `.txt`, or `.md` transcript file.

## Purpose

Transform raw user discovery interviews into actionable product insights, jobs to be done, and thesis validation—regardless of whether a PRD exists yet.

## Workflow

### Step 1: Gather Context

Before analyzing, ask the user (if not already provided):

1. **Product/Problem Area**: "What product or problem space does this interview relate to?"
2. **Thesis Status**: One of:
   - "Do you have an existing thesis or hypothesis you're testing?" (if yes, ask for document path or description)
   - "Are you exploring to develop a thesis?"
   - "No thesis yet—open exploration"
3. **PRD Reference** (optional): "Is there an existing PRD to map insights against, or should I generate standalone JTBD?"
4. **Participant Context**: "Any context about the interviewee I should know?" (role, organization, experience level)

If the user provides these details upfront in their prompt, skip the questions.

### Step 2: Read and Process

1. Convert `.docx` files to text using `textutil` if needed
2. Read the transcript
3. If a PRD path was provided, read it to understand existing requirements structure
4. If a thesis document was provided, read it to understand hypotheses being tested

### Step 3: Generate Analysis

Create a markdown document with these sections:

---

## Output Structure

### Header

```markdown
# [Product/Problem Area] Discovery Analysis

**Date:** [Interview date or today]
**Participant:** [Name, role, organization if known]
**Interviewer:** [If identifiable]
**Focus:** [1-2 sentence summary of interview scope]
```

### Thesis Section

Include ONE of the following based on Step 1:

**If testing an existing thesis:**
```markdown
## Thesis Validation

### Hypothesis Under Test
> [State the thesis being tested]

### Evidence Supporting
- [Quote or finding that supports thesis]
- [...]

### Evidence Challenging
- [Quote or finding that challenges thesis]
- [...]

### Validation Status
[Supported / Partially Supported / Challenged / Insufficient Data]

### Recommended Thesis Refinements
- [Suggested modifications based on findings]
```

**If exploring to develop a thesis:**
```markdown
## Emerging Theses

Based on this interview, the following hypotheses warrant further exploration:

### Thesis 1: [Title]
> [Hypothesis statement in testable form]

**Supporting Evidence:**
- [Quote or observation]

**Questions to Validate:**
- [What would need to be true?]
- [Who else should we talk to?]

### Thesis 2: [Title]
[Same structure...]
```

**If open exploration (no thesis):**
```markdown
## Thesis Candidates

This interview suggests the following potential product theses to explore:

| # | Thesis | Confidence | Next Step |
|---|--------|------------|-----------|
| 1 | [Statement] | Low/Medium/High | [Validate with X] |
| 2 | [Statement] | Low/Medium/High | [Validate with X] |

### Strongest Signal
[Which thesis has the most evidence and why]
```

### Key Insights Section

```markdown
## Key Insights

### 1. [Insight Title]

> "[Direct quote from interview]"

[2-3 sentence explanation of what this means]

**Implication:** [What this means for product/design decisions]

---

[Repeat for 5-8 key insights]
```

### Jobs to Be Done Section

**If PRD exists:** Map to existing JTBD structure and note:
- Enhancements to existing jobs
- New jobs to add
- Jobs that may need reprioritization

**If no PRD exists:** Generate standalone JTBD:

```markdown
## Jobs to Be Done

### Job 1: [Title] (Suggested Priority: P0/P1/P2)

**When** [situation/trigger]
**I want to** [action/capability]
**So that** [outcome/benefit]

**Evidence:** [Quote or observation that surfaced this job]

**Acceptance Criteria:**
- [Measurable criterion]
- [...]

---

[Repeat for each job identified]
```

### Persona Insights Section

```markdown
## Persona Insights

### [Persona Name/Type]

- **Role:** [What they do]
- **Context:** [When/how they'd use the product]
- **Key Needs:** [Top 2-3 needs]
- **Pain Points:** [Current frustrations]
- **Success Metric:** [How they'd measure success]

[Note if this confirms, refines, or suggests a new persona vs. existing docs]
```

### Open Questions Section

```markdown
## Open Questions

| Question | Source | Priority |
|----------|--------|----------|
| [Question raised by interview] | [Quote or context] | High/Medium/Low |
```

### Raw Quotes Section

```markdown
## Key Quotes for Reference

### On [Topic]
> "[Direct quote]"

[Repeat for 5-10 most useful quotes organized by theme]
```

---

## Guidelines

### Quote Selection
- Prioritize quotes that reveal unmet needs, workarounds, or emotional reactions
- Include quotes that challenge assumptions, not just confirm them
- Preserve participant's language—don't sanitize jargon if it's meaningful

### JTBD Writing
- Use participant's language in the "When" trigger when possible
- Keep "I want to" focused on capability, not implementation
- "So that" should express the real outcome, not a feature benefit

### Thesis Development
- A good thesis is specific enough to be falsifiable
- Include confidence level based on single interview (always note limited sample size)
- Suggest who else to interview to validate/challenge

### Handling Sensitive Content
- Flag any CUI, ITAR, or classification concerns
- Redact specific operational details if noted as sensitive
- Note if interview content should be restricted

### Red 6 Context Awareness
- Understand defense/aerospace terminology (reference user's CLAUDE.md glossary)
- Recognize when interviewee is describing existing military processes vs. wishlists
- Note platform-specific insights (different aircraft have different constraints)

## Example Invocations

```
/user-discovery /Users/derek/Downloads/pilot_interview.docx

We're testing the thesis that "IPs want to customize every scenario from scratch."
The interview is with a Navy instructor pilot.
```

```
/user-discovery /path/to/transcript.txt

Open exploration - we're trying to understand how mission planners currently
work with JMPS. No PRD yet.
```

```
/user-discovery /path/to/call.vtt

Validate against the PRD at /path/to/PRD.md - looking specifically for
insights on the template workflow.
```
