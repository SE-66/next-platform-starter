const form = document.querySelector("#upload-form");
const fileInput = document.querySelector("#file");
const submit = document.querySelector("#submit");
const statusEl = document.querySelector("#status");
const resultsEl = document.querySelector("#results");
const metricsEl = document.querySelector("#metrics");
const findingsEl = document.querySelector("#findings");
const semanticEl = document.querySelector("#semantic-nodes");
const identityEl = document.querySelector("#identity-assessments");
const testsEl = document.querySelector("#tests");
const findingCount = document.querySelector("#finding-count");
const semanticCount = document.querySelector("#semantic-count");
const identityCount = document.querySelector("#identity-count");
const testCount = document.querySelector("#test-count");
const runMeta = document.querySelector("#run-meta");

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function pct(value) {
  return `${Math.round(Number(value || 0) * 100)}%`;
}

function renderMetrics(summary) {
  const items = [
    ["Sheets", summary.sheets],
    ["Formulas", summary.formulaCells],
    ["Findings", summary.findings],
    ["Identity checks", summary.identityChecks],
    ["Identity violations", summary.identityViolations],
    ["Tests", summary.counterfactualTests],
    ["Passed", summary.testsPassed],
    ["Failed", summary.testsFailed],
    ["Unsupported", summary.testsUnsupported]
  ];

  metricsEl.innerHTML = items.map(([label, value]) => `
    <div class="metric">
      <strong>${esc(value)}</strong>
      <span>${esc(label)}</span>
    </div>
  `).join("");
}

function renderFindings(findings) {
  findingCount.textContent = `${findings.length} found`;

  if (!findings.length) {
    findingsEl.innerHTML =
      '<div class="empty">No structural heuristic issues were found. This does not prove the model is financially correct.</div>';
    return;
  }

  findingsEl.innerHTML = findings.map(finding => `
    <article class="finding">
      <div class="severity ${esc(finding.severity)}">${esc(finding.severity)}</div>
      <h3>${esc(finding.title)}</h3>
      <p>${esc(finding.details)}</p>
      <div class="meta">
        ${finding.sheet ? esc(finding.sheet) : ""}
        ${finding.cell ? " · " + esc(finding.cell) : ""}
        · ${esc(finding.code)}
      </div>
    </article>
  `).join("");
}

function renderSemanticNodes(nodes) {
  semanticCount.textContent = `${nodes.length} inferred`;

  if (!nodes.length) {
    semanticEl.innerHTML =
      '<div class="empty">No supported financial roles were inferred from this workbook.</div>';
    return;
  }

  semanticEl.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Role</th>
          <th>Label</th>
          <th>Location</th>
          <th>Type</th>
          <th>Confidence</th>
        </tr>
      </thead>
      <tbody>
        ${nodes.slice(0, 80).map(node => `
          <tr>
            <td><strong>${esc(node.role)}</strong></td>
            <td>${esc(node.label || "—")}</td>
            <td><code>${esc(node.sheet)}!${esc(node.cell)}</code></td>
            <td>${node.formula ? "formula" : "assumption"}</td>
            <td>${pct(node.confidence)}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}


function renderIdentities(assessments) {
  const violations = assessments.filter(item => item.status === "violated");
  identityCount.textContent =
    `${assessments.length} checked · ${violations.length} violated`;

  if (!assessments.length) {
    identityEl.innerHTML =
      '<div class="empty">No supported financial identities were available for this workbook.</div>';
    return;
  }

  identityEl.innerHTML = assessments.slice(0, 60).map(item => {
    const bestCompeting = (item.hypotheses || [])
      .filter(h => !h.canonical)
      .sort((a, b) => b.score - a.score)[0];

    const materiality = item.materiality;
    const materialityText = materiality && materiality.rank !== "unknown"
      ? ` · Materiality: ${esc(materiality.rank)}${materiality.relativeImpact === undefined ? "" : " (" + esc((materiality.relativeImpact * 100).toFixed(1)) + "%)"}`
      : "";

    return `
      <article class="finding">
        <div class="severity ${item.status === "violated" ? "high" : item.status === "confirmed" ? "low" : "medium"}">
          ${esc(item.status)}
        </div>
        <h3>${esc(item.identityName)}</h3>
        <p><strong>Expected:</strong> ${esc(item.canonicalExpression)}</p>
        <p><strong>Observed semantics:</strong> <code>${esc(item.semanticExpression)}</code></p>
        <p>${esc(item.explanation)}</p>
        <div class="meta">
          ${esc(item.sheet)}!${esc(item.cell)}
          · confidence ${pct(item.confidence)}
          ${bestCompeting ? " · competing: " + esc(bestCompeting.name) + " (" + esc(Math.round(bestCompeting.score * 100)) + "%)" : ""}
          ${materialityText}
        </div>
      </article>
    `;
  }).join("");
}

function renderTests(tests) {
  testCount.textContent = `${tests.length} generated`;

  if (!tests.length) {
    testsEl.innerHTML =
      '<div class="empty">No supported assumption-to-output dependency path was found for the current rule library.</div>';
    return;
  }

  testsEl.innerHTML = `
    <div class="test-grid">
      ${tests.map(test => `
        <article class="test-card">
          <div class="eyebrow">
            Confidence ${pct(test.confidence)} · ${esc(test.executionStatus)}
          </div>
          <h3>${esc(test.title)}</h3>
          <div class="test-route">
            <span class="node">${esc(test.input.sheet)}!${esc(test.input.cell)}</span>
            <span class="arrow">→</span>
            <span class="node">${esc(test.output.sheet)}!${esc(test.output.cell)}</span>
          </div>
          <p>${esc(test.rationale)}</p>
          <div class="meta">
            Input baseline: ${test.input.baselineValue === undefined ? "unknown" : esc(test.input.baselineValue)}
            ${test.perturbedInput === undefined ? "" : " · Perturbed input: " + esc(test.perturbedInput)}
            ${test.baselineOutput === undefined ? "" : " · Output: " + esc(test.baselineOutput)}
            ${test.perturbedOutput === undefined ? "" : " → " + esc(test.perturbedOutput)}
            ${test.observedDirection ? " · Observed: " + esc(test.observedDirection) : ""}
            ${test.materialityRank ? " · Materiality: " + esc(test.materialityRank) : ""}
            ${test.relativeImpact === undefined ? "" : " (" + esc((test.relativeImpact * 100).toFixed(1)) + "%)"}
            · Path length: ${esc(test.dependencyPath.length)}
          </div>
          ${test.executionError ? `<p class="meta">Not executed: ${esc(test.executionError)}</p>` : ""}
        </article>
      `).join("")}
    </div>
  `;
}

form.addEventListener("submit", async event => {
  event.preventDefault();
  const file = fileInput.files?.[0];
  if (!file) return;

  submit.disabled = true;
  statusEl.classList.remove("error");
  statusEl.textContent = "Analyzing workbook structure and generating tests…";
  resultsEl.classList.add("hidden");

  try {
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch("/api/analyze", {
      method: "POST",
      body: formData
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || data.detail || "Analysis failed");
    }

    renderMetrics(data.summary);
    renderFindings(data.findings || []);
    renderSemanticNodes(data.semanticNodes || []);
    renderIdentities(data.identityAssessments || []);
    renderTests(data.counterfactualTests || []);

    runMeta.innerHTML =
      `Run <code>${esc(data.runId)}</code> · storage: ${esc(data.persistence)} · ${esc(data.fileName)}`;

    resultsEl.classList.remove("hidden");
    statusEl.textContent = "Analysis complete.";
  } catch (error) {
    statusEl.classList.add("error");
    statusEl.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    submit.disabled = false;
  }
});
