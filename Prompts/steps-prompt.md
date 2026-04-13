
---

**Project Root:**
`C:\Users\user\Documents\ANDREI_FILES\PDM_FILES\2ND YEAR\2ND SEM\LTE\CASE-STUDY`

---

**Enhanced Prompt:**

You are operating inside the specified project directory. Begin by analyzing the existing project structure and all files inside the `Prompts` folder. These contain prior plans, system design decisions, and feature discussions that must be treated as the single source of truth.

Objective: Construct a complete, execution-ready roadmap for building a **Simulated IoT + Real Web System Hybrid** using the Wokwi extension in VS Code.

### Instructions

1. **Context Analysis**

   * Parse all files in `Prompts/`.
   * Extract system goals, components, constraints, and architecture decisions.
   * Infer missing links between IoT simulation (Wokwi) and the web system.

2. **System Breakdown**

   * Decompose the project into major subsystems:

     * IoT Simulation Layer (Wokwi)
     * Backend/API Layer
     * Frontend/Web Interface
     * Data Flow / Communication Layer
     * Storage / Database (if applicable)
   * Define clear boundaries and responsibilities for each subsystem.

3. **Task Generation (Core Requirement)**

   * Generate a **strict, ordered, step-by-step TODO list** to build the entire system from scratch to completion.
   * Tasks must be:

     * Atomic (one clear action per task)
     * Sequential (correct dependency order)
     * Implementation-focused (no vague steps)

4. **Reasoning Layer**

   * For each task, include:

     * **Purpose:** Why this task exists
     * **Outcome:** What should be achieved after completion
     * **Dependency:** What must be done before this task (if any)

5. **Technical Specificity**

   * Include exact tools, frameworks, and files to be created or modified.
   * Explicitly reference:

     * Wokwi simulation setup (ESP32/Arduino, sensors, etc.)
     * Communication method (e.g., HTTP, WebSocket, MQTT)
     * Backend technology (e.g., .NET, Node.js)
     * Frontend structure (if applicable)
   * Define integration points between Wokwi and the web system.

6. **File Output Requirement**

   * Save the final output as a structured markdown file at:
     `Memory/TODO.md`

7. **Markdown Format**
   Use this structure strictly:

   ```
   # Project TODO Roadmap

   ## Phase X: <Phase Name>

   ### Task X.X: <Task Title>
   - Action:
   - Purpose:
   - Outcome:
   - Dependencies:
   ```

8. **Execution Standard**

   * No skipped steps
   * No assumptions without stating them
   * No redundancy
   * Ensure full coverage from initial setup → final working system

---
