"""The live Oracle: an open conversation instead of the scripted story.

  prompts.py   builds the system prompts from content/oracle/
  brains.py    ClaudeBrain (the real thing, needs an API key) and MockBrain (offline)
  session.py   one visitor's conversation, its log file and its receipt
  receipt.py   formats the reading as a 32-column receipt

oracle/server.py serves the web page and this conversation over HTTP.
"""

from oracle.conversation.brains import ClaudeBrain, MockBrain, Reading, Reply, make_brain
from oracle.conversation.prompts import OraclePrompts, load_prompts
from oracle.conversation.session import Conversation, Conversations

__all__ = [
    "ClaudeBrain",
    "Conversation",
    "Conversations",
    "MockBrain",
    "OraclePrompts",
    "Reading",
    "Reply",
    "load_prompts",
    "make_brain",
]
