# Example Output: Navy Discovery Analysis

This is an example of what the user-discovery skill generates from an interview transcript.

---

# Mission Planning Discovery Analysis

**Date:** February 2, 2026
**Participant:** Tim F. (Navy pilot, NAS Oceana experience)
**Interviewer:** Derek C.
**Focus:** U.S. Navy mission planning workflows for undergraduate jet training

---

## Thesis Validation

### Hypothesis Under Test
> "Instructors want to customize training scenarios from scratch for each sortie."

### Evidence Supporting
- None found

### Evidence Challenging
- "For U Jets, I'd want it all pre-scripted and aligned to the syllabus... There's not a whole lot of autonomy or thought in U Jets. It's a script."
- Templates are already standard practice for working areas
- Changes are "by exception" not daily

### Validation Status
**Challenged** - For undergraduate training, the opposite is true. Instructors want pre-built scenarios aligned to syllabus, with rare exceptions.

### Recommended Thesis Refinements
- Revise to: "Instructors want syllabus-aligned scenario templates with exception-based modification"
- Segment by user type: undergraduate training vs. mission readiness training may differ

---

## Key Insights

### 1. Geography-First Planning Approach

> "The first thing you think of is where in the world are you actually operating"

Navy planners start with operational boundaries before anything else: working areas, entry/exit points, reference points coded with names.

**Implication:** Airspace boundary definition should be a foundational feature, not an afterthought.

---

### 2. Reference Points Are Named, Not Just Coordinates

> "You don't always have to talk in lat long specifically, but you're referencing it by IP Stallion or IP Mustang"

Tactical communication uses named points from SPINS. Pilots memorize codes, not raw coordinates.

**Implication:** Support named reference points that map to lat/longs; consider bulk import capability.

---

## Jobs to Be Done

### Job: Create Syllabus-Aligned Scenario Bundles (Suggested Priority: P1)

**When** I'm setting up for an undergraduate training program
**I want to** load an entire syllabus of pre-built scenarios mapped to sortie numbers
**So that** instructors can select scenarios by sortie ID rather than building from scratch

**Evidence:** "I would want to basically have that as a button saying OK, sortie 1.1 boom and next thing you know Mig 29 spawns next to me"

**Acceptance Criteria:**
- Support scenario "bundles" organized by syllabus structure
- Sortie naming convention (e.g., BFM 1.1, ACM 2.3)
- One-click load of sortie-specific scenario
- Exception-based modification capability

---

## Persona Insights

### Training Command Instructor (Undergraduate)

- **Role:** Runs standardized syllabus hops for student aviators
- **Context:** Uses pre-built scenarios 84% of the time; modifies by exception only
- **Key Needs:** One-click scenario selection by sortie number
- **Pain Points:** Any friction in accessing standard scenarios
- **Success Metric:** Zero planning time for standard syllabus hops

---

## Open Questions

| Question | Source | Priority |
|----------|--------|----------|
| What is the physical export mechanism for classified environments? | "Brick" workflow described | High |
| Who is the primary user—technician or instructor? | Raised in interview | High |

---

## Key Quotes for Reference

### On Simplicity
> "For U Jets, I'd want it all pre-scripted and aligned to the syllabus and then defaults would be by exception."

### On Trust
> "You trust the system because the tolerance allows you to fly that mission without question."
