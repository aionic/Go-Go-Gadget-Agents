"""Create the multi-agent structure used by the agent UI.

Builds three agents in the Foundry project:

  * Researcher — gathers and structures the key facts for a request.
  * Writer     — composes the final, well-structured answer.
  * Planner    — the router the UI talks to. It decides whether a request is
                 simple enough to answer directly, or warrants the
                 research -> write pipeline. The UI route orchestrates the
                 handoffs to Researcher/Writer (client-side orchestration);
                 we no longer use Foundry *connected agents*, which the
                 service no longer executes reliably for this model.

The script is idempotent: any pre-existing agents with the same names are
deleted and recreated so instructions stay in sync. The Planner's agent id is
printed as `FOUNDRY_AGENT_ID=<id>` and written to `planner_agent_id.txt` so it
can be fed to Terraform (var.foundry_agent_id). The Researcher/Writer ids are
resolved by name at runtime by the UI route.

Auth uses DefaultAzureCredential (the deploying user / managed identity). The
caller needs the Foundry "Azure AI User" / "Foundry User" data-plane role.

Run via:  uv run create_agents.py

Environment variables:
  FOUNDRY_PROJECT_ENDPOINT   (required)  e.g. https://<acct>.services.ai.azure.com/api/projects/<project>
  MODEL_DEPLOYMENT           (optional, default "gpt-5.4-mini")
"""

from __future__ import annotations

import os
import sys

from azure.identity import DefaultAzureCredential
from azure.ai.agents import AgentsClient

PROJECT_ENDPOINT = os.environ["FOUNDRY_PROJECT_ENDPOINT"]
MODEL_DEPLOYMENT = os.environ.get("MODEL_DEPLOYMENT", "gpt-5.4-mini")

RESEARCHER_NAME = "Researcher"
WRITER_NAME = "Writer"
PLANNER_NAME = "Planner"

RESEARCHER_INSTRUCTIONS = (
    "You are the Researcher. Given a user request and the planner's brief, "
    "identify the key facts, constraints, and considerations needed to answer "
    "it well. Reason step by step and return a concise, structured set of "
    "findings (bullet points grouped by theme). Do not write the final prose "
    "answer — that is the Writer's job. If information is uncertain, say so."
)

WRITER_INSTRUCTIONS = (
    "You are the Writer. Given the original request and the Researcher's "
    "findings, compose the final answer for the user. Be clear and well "
    "structured: use short paragraphs, headings, and bullet lists where they "
    "help. Lead with the most useful information. Do not invent facts beyond "
    "the findings provided."
)

# The Planner is a *router*. It returns a single JSON object and nothing else,
# so the UI route can decide whether to answer directly (simple requests) or
# trigger the Researcher -> Writer pipeline (requests that need real work).
PLANNER_INSTRUCTIONS = (
    "You are the Planner, a routing controller for a small team. For each "
    "user request decide whether it needs the research+writing pipeline.\n\n"
    "Reply with ONE JSON object and nothing else (no prose, no code fences):\n"
    '  - Simple request (greeting, small talk, a short factual question you '
    "can answer well in 1-3 sentences): "
    '{"mode":"direct","answer":"<your concise answer>"}\n'
    '  - Substantive request (needs research, comparison, analysis, or a '
    "longer structured/written deliverable): "
    '{"mode":"pipeline","brief":"<one-sentence brief telling the research '
    'team what to investigate>"}\n\n'
    "Choose \"direct\" whenever you can fully answer briefly yourself. Choose "
    '"pipeline" only when the extra research and writing genuinely improve the '
    "answer. Output must be valid JSON parseable as-is."
)


def _delete_existing(agents_client, names: set[str]) -> None:
    """Delete any agents whose name is in `names` (idempotent re-create)."""
    for agent in agents_client.list_agents():
        if getattr(agent, "name", None) in names:
            print(f"Deleting existing agent {agent.name} ({agent.id})")
            try:
                agents_client.delete_agent(agent.id)
            except Exception as exc:  # noqa: BLE001 — tolerate already-gone
                print(f"  (skip: {exc})")


def main() -> int:
    credential = DefaultAzureCredential()
    agents_client = AgentsClient(endpoint=PROJECT_ENDPOINT, credential=credential)

    with agents_client:
        _delete_existing(
            agents_client, {RESEARCHER_NAME, WRITER_NAME, PLANNER_NAME}
        )

        researcher = agents_client.create_agent(
            model=MODEL_DEPLOYMENT,
            name=RESEARCHER_NAME,
            instructions=RESEARCHER_INSTRUCTIONS,
        )
        print(f"Created {RESEARCHER_NAME}: {researcher.id}")

        writer = agents_client.create_agent(
            model=MODEL_DEPLOYMENT,
            name=WRITER_NAME,
            instructions=WRITER_INSTRUCTIONS,
        )
        print(f"Created {WRITER_NAME}: {writer.id}")

        planner = agents_client.create_agent(
            model=MODEL_DEPLOYMENT,
            name=PLANNER_NAME,
            instructions=PLANNER_INSTRUCTIONS,
        )
        print(f"Created {PLANNER_NAME}: {planner.id}")

        out_path = os.path.join(
            os.path.dirname(__file__), "planner_agent_id.txt"
        )
        with open(out_path, "w", encoding="utf-8") as fh:
            fh.write(planner.id)

        print(f"RESEARCHER_AGENT_ID={researcher.id}")
        print(f"WRITER_AGENT_ID={writer.id}")
        print(f"FOUNDRY_AGENT_ID={planner.id}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(1)
