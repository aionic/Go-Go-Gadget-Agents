# Copyright (c) Microsoft. All rights reserved.
"""GGGA Planner — hosted Agent Framework agent (Responses protocol).

The Planner is a routing controller. For each request it returns ONE JSON
object so the caller can decide whether to answer directly (simple requests)
or trigger the Researcher -> Writer pipeline (substantive requests).
"""

import os

from agent_framework import Agent
from agent_framework.foundry import FoundryChatClient
from agent_framework_foundry_hosting import ResponsesHostServer
from azure.identity import DefaultAzureCredential
from dotenv import load_dotenv

load_dotenv()

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
    'Choose "direct" whenever you can fully answer briefly yourself. Choose '
    '"pipeline" only when the extra research and writing genuinely improve the '
    "answer. Output must be valid JSON parseable as-is."
)


def main() -> None:
    client = FoundryChatClient(
        project_endpoint=os.environ["FOUNDRY_PROJECT_ENDPOINT"],
        model=os.environ["AZURE_AI_MODEL_DEPLOYMENT_NAME"],
        credential=DefaultAzureCredential(),
    )

    agent = Agent(
        client=client,
        instructions=PLANNER_INSTRUCTIONS,
        # History is managed by the hosting infrastructure.
        default_options={"store": False},
    )

    server = ResponsesHostServer(agent)
    server.run()


if __name__ == "__main__":
    main()
