# Copyright (c) Microsoft. All rights reserved.
"""GGGA Writer — hosted Agent Framework agent (Responses protocol).

Given the original request and the Researcher's findings, the Writer composes
the final, well-structured answer for the user.
"""

import os

from agent_framework import Agent
from agent_framework.foundry import FoundryChatClient
from agent_framework_foundry_hosting import ResponsesHostServer
from azure.identity import DefaultAzureCredential
from dotenv import load_dotenv

load_dotenv()

WRITER_INSTRUCTIONS = (
    "You are the Writer. Given the original request and the Researcher's "
    "findings, compose the final answer for the user. Be clear and well "
    "structured: use short paragraphs, headings, and bullet lists where they "
    "help. Lead with the most useful information. Do not invent facts beyond "
    "the findings provided."
)


def main() -> None:
    client = FoundryChatClient(
        project_endpoint=os.environ["FOUNDRY_PROJECT_ENDPOINT"],
        model=os.environ["AZURE_AI_MODEL_DEPLOYMENT_NAME"],
        credential=DefaultAzureCredential(),
    )

    agent = Agent(
        client=client,
        instructions=WRITER_INSTRUCTIONS,
        default_options={"store": False},
    )

    server = ResponsesHostServer(agent)
    server.run()


if __name__ == "__main__":
    main()
