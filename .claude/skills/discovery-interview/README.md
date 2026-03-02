# User Discovery Interview Synthesizer

A Claude Code skill that transforms raw user discovery interviews into actionable product insights, jobs to be done, and thesis validation.

## Installation

1. Clone this repo into your Claude Code skills directory:
   ```bash
   git clone https://github.com/YOUR_USERNAME/user-discovery-skill.git ~/.claude/skills/user-discovery
   ```

2. Or copy the `SKILL.md` file directly:
   ```bash
   mkdir -p ~/.claude/skills/user-discovery
   cp SKILL.md ~/.claude/skills/user-discovery/
   ```

## Usage

```
/user-discovery [file_path]
```

### Supported File Types
- `.docx` - Word documents (auto-converted)
- `.vtt` - Video transcript files
- `.txt` - Plain text transcripts
- `.md` - Markdown transcripts

### Example Invocations

**Testing an existing thesis:**
```
/user-discovery /path/to/interview.docx

We're testing the thesis that "users want to customize every scenario from scratch."
```

**Open exploration (no thesis):**
```
/user-discovery /path/to/transcript.txt

Open exploration - trying to understand current workflows. No PRD yet.
```

**Validating against existing PRD:**
```
/user-discovery /path/to/call.vtt

Validate against the PRD at /path/to/PRD.md
```

## What It Generates

The skill produces a structured markdown analysis with:

| Section | Description |
|---------|-------------|
| **Thesis Validation/Development** | Tests existing hypotheses or suggests new ones |
| **Key Insights** | 5-8 insights with direct quotes and implications |
| **Jobs to Be Done** | JTBD format requirements (works with or without existing PRD) |
| **Persona Insights** | User archetypes with needs, pain points, success metrics |
| **Open Questions** | Questions raised by the interview for follow-up |
| **Key Quotes** | Raw quotes organized by theme for reference |

## Thesis Modes

The skill handles three thesis scenarios:

1. **Validating existing thesis** - You provide a hypothesis; skill evaluates evidence for/against
2. **Developing thesis** - You're exploring; skill surfaces emerging hypotheses with validation questions
3. **Open exploration** - No thesis yet; skill suggests thesis candidates with confidence levels

## Context Gathering

If not provided upfront, the skill will ask:
- What product/problem area does this relate to?
- Do you have an existing thesis to test?
- Is there a PRD to map insights against?
- Any context about the interviewee?

## Output Location

By default, analysis is output directly. To save to a file, specify in your prompt:
```
/user-discovery /path/to/transcript.docx

Save to /path/to/output/folder/
```

## Requirements

- Claude Code CLI
- macOS (uses `textutil` for .docx conversion)

## License

MIT License - see [LICENSE](LICENSE)
