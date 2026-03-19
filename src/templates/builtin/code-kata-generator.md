---
name: Code Kata Generator
description: Generate coding exercises based on the project's codebase to teach patterns, domain concepts, and skills.
category: learning
agents: [any]
panels: 1
---
Generate a set of coding exercises (katas) based on this project's actual codebase. Each kata should teach a specific skill, pattern, or domain concept that is directly relevant to working on this project.

Analyze the codebase to identify the most important patterns, architectural decisions, and domain concepts. Then create 5-8 katas of increasing difficulty.

For each kata, provide:

1. **Title** - A clear, descriptive name (e.g., "Implement a Custom Middleware", "Add a New Event Handler").

2. **Difficulty** - Beginner, Intermediate, or Advanced. Beginners should be completable in 15-30 minutes by someone new to the project. Advanced katas may take 1-2 hours.

3. **Learning Objective** - What specific skill or concept does this kata teach? Be explicit: "After completing this kata, you will understand how the repository pattern is used to abstract database access in this project."

4. **Background** - Brief context about the part of the codebase this kata relates to. Reference specific files and modules. Explain just enough for the developer to understand the domain without giving away the solution.

5. **Setup Instructions** - How to isolate this exercise. This might involve:
   - Creating a new file in a specific directory
   - Working in a branch with a failing test already written
   - Setting up a specific test fixture or mock
   - Provide exact commands to set up the exercise environment

6. **Problem Statement** - A clear, unambiguous description of what to build or fix. Include:
   - Functional requirements (what it should do)
   - Interface requirements (what signatures/types to implement)
   - Acceptance criteria (how to know it is done)
   - Any constraints (must use existing patterns, must maintain backward compatibility)

7. **Hints** - Three progressive hints, each revealing more of the solution approach:
   - Hint 1: A gentle nudge in the right direction ("Look at how X is implemented in file Y")
   - Hint 2: A structural suggestion ("You will need to create a class that implements the Z interface")
   - Hint 3: A near-complete approach ("Follow the same pattern as the existing A module: first do B, then C, then register it in D")

8. **Solution** - A complete, well-commented reference solution. Explain why each part is written the way it is. Note any acceptable alternative approaches.

9. **Extension Challenges** - Optional ways to extend the kata for developers who want to go deeper: add error handling, write tests, optimize performance, handle edge cases.

Design the katas so they build on each other when possible, creating a learning path. The first kata should be achievable by reading existing code and following the pattern. The last kata should require genuine problem-solving within the project's architecture.
