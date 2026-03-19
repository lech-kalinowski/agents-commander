---
name: Protocol Demo
description: Demonstrates all Commander protocol features - SEND, REPLY, BROADCAST, STATUS, QUERY
category: collaboration
agents: [claude, codex, gemini]
panels: 3
---
You are running a demonstration of all Agents Commander protocol features.

You have already been given the protocol instructions (via Ctrl+P injection). Now walk through each feature one at a time, waiting for the Commander ACK or response after each step before proceeding.

Step 1: QUERY
Use the QUERY command to ask Commander what agents are currently running. The query content should be: agents

Step 2: STATUS
After you receive the query response, use the STATUS command to report progress. The status text should be: Protocol demo in progress - Step 2 of 5
Wait for the STATUS acknowledgment in your panel before continuing.

Step 3: SEND
Send a direct message to the agent in Panel 2. Ask them to confirm they received the message by replying back to you.

Step 4: REPLY
When you receive a reply from the other agent, use REPLY to send them a thank-you message confirming the reply chain works.

Step 5: BROADCAST
Use BROADCAST to send a message to all connected agents. The broadcast should say: Protocol demo complete - all features verified.

After all steps are done, use STATUS one final time to report: Protocol demo finished successfully.

IMPORTANT: Execute each step ONE AT A TIME. After outputting each protocol command block, STOP and wait for the ACK or response from Commander before proceeding to the next step. STATUS also gets a Commander ACK after the UI toast. Do not output multiple protocol blocks at once.
