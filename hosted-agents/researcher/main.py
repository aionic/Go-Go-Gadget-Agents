# Copyright (c) Microsoft. All rights reserved.
"""GGGA Researcher — hosted Agent Framework agent (Responses protocol).

Given a user request and the Planner's brief, the Researcher identifies the
key facts and considerations and returns a concise, structured set of
findings. It does not write the final prose answer — that is the Writer's job.
"""

import os

from agent_framework import Agent
from agent_framework.foundry import FoundryChatClient
from agent_framework_foundry_hosting import ResponsesHostServer
from azure.identity import DefaultAzureCredential
from dotenv import load_dotenv

load_dotenv()

RESEARCHER_INSTRUCTIONS = (
    "You are the Researcher. Given a user request and the planner's brief, "
    "identify the key facts, constraints, and considerations needed to answer "
    "it well. Reason step by step and return a concise, structured set of "
    "findings (bullet points grouped by theme). Do not write the final prose "
    "answer — that is the Writer's job. If information is uncertain, say so."
)


def main() -> None:
    client = FoundryChatClient(
        project_endpoint=os.environ["FOUNDRY_PROJECT_ENDPOINT"],
        model=os.environ["AZURE_AI_MODEL_DEPLOYMENT_NAME"],
        credential=DefaultAzureCredential(),
    )

    agent = Agent(
        client=client,
        instructions=RESEARCHER_INSTRUCTIONS,
        default_options={"store": False},
    )

    server = ResponsesHostServer(agent)
    server.run()


if __name__ == "__main__":
    main()
