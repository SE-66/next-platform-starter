const form = document.querySelector("#upload-form");
const fileInput = document.querySelector("#file");
const submit = document.querySelector("#submit");
const statusEl = document.querySelector("#status");
const resultsEl = document.querySelector("#results");
const metricsEl = document.querySelector("#metrics");
const findingsEl = document.querySelector("#findings");
const semanticEl = document.querySelector("#semantic-nodes");
const identityEl = document.querySelector("#identity-assessments");
const hypothesisEl = document.querySelector("#hypothesis-experiments");
const testsEl = document.querySelector("#tests");
const findingCount = document.querySelector("#finding-count");
const semanticCount = document.querySelector("#semantic-count");
const identityCount = document.querySelector("#identity-count");
const hypothesisCount = document.querySelector("#hypothesis-count");
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
    ["Issue families", summary.identityViolationGroups],
    ["Generated hypotheses", summary.generatedHypotheses],
    ["Hypothesis experiments", summary.hypothesisExperiments],
    ["Hypothesis mismatches", summary.hypothesisMismatches],
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

  findingsEl.innerHTML = findings.map(finding => {
    const evidence = finding.evidence || {};
    const causes = Array.isArray(evidence.rootCauseCandidates)
      ? evidence.rootCauseCandidates
      : [];
    const materiality = evidence.materiality || null;
    const topCause = causes[0];

    return `
      <article class="finding">
        <div class="severity ${esc(finding.severity)}">${esc(finding.severity)}</div>
        <h3>${esc(finding.title)}</h3>
        <p>${esc(finding.details)}</p>
        ${topCause ? `
          <p class="meta">
            Likely root cause: <code>${esc(topCause.cellKey)}</code>
            · score ${esc(Math.round(Number(topCause.score || 0) * 100))}%
            · ${esc(topCause.reason)}
          </p>
        ` : ""}
        ${materiality && materiality.rank ? `
          <p class="meta">
            Materiality: ${esc(materiality.rank)}
            ${materiality.relativeImpact === undefined
              ? ""
              : " · " + esc((Number(materiality.relativeImpact) * 100).toFixed(1)) + "% relative impact"}
          </p>
        ` : ""}
        <div class="meta">
          ${finding.sheet ? esc(finding.sheet) : ""}
          ${finding.cell ? " · " + esc(finding.cell) : ""}
          · ${esc(finding.code)}
        </div>
      </article>
    `;
  }).join("");
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


function renderIdentities(assessments, groups) {
  const violations = assessments.filter(item => item.status === "violated");
  identityCount.textContent =
    `${assessments.length} checked · ${violations.length} cell violations · ${groups.length} issue families`;

  if (!assessments.length) {
    identityEl.innerHTML =
      '<div class="empty">No supported financial identities were available for this workbook.</div>';
    return;
  }

  const groupCards = groups.map(group => {
    const bestCompeting = (group.hypotheses || [])
      .filter(h => !h.canonical)
      .sort((a, b) => b.score - a.score)[0];

    const materiality = group.worstMateriality;
    const materialityText =
      materiality && materiality.rank !== "unknown"
        ? ` · Materiality: ${esc(materiality.rank)}${materiality.relativeImpact === undefined ? "" : " (" + esc((materiality.relativeImpact * 100).toFixed(1)) + "%)"}`
        : "";

    return `
      <article class="finding">
        <div class="severity ${materiality?.rank === "critical" ? "critical" : group.confidence >= 0.85 ? "high" : "medium"}">
          issue family
        </div>
        <h3>${esc(group.identityName)}</h3>
        <p><strong>Expected:</strong> ${esc(group.canonicalExpression)}</p>
        <p><strong>Observed semantics:</strong> <code>${esc(group.semanticExpression)}</code></p>
        <p>${esc(group.explanation)}</p>
        <div class="meta">
          ${esc(group.sheet)}!${esc(group.affectedRange)}
          · ${esc(group.affectedCount)} affected period${group.affectedCount === 1 ? "" : "s"}
          · confidence ${pct(group.confidence)}
          ${bestCompeting ? " · competing: " + esc(bestCompeting.name) + " (" + esc(Math.round(bestCompeting.score * 100)) + "%)" : ""}
          ${materialityText}
        </div>
      </article>
    `;
  }).join("");

  const nonViolations = assessments
    .filter(item => item.status !== "violated")
    .slice(0, 24)
    .map(item => {
      const bestCompeting = (item.hypotheses || [])
        .filter(h => !h.canonical)
        .sort((a, b) => b.score - a.score)[0];

      return `
        <article class="finding">
          <div class="severity ${item.status === "confirmed" ? "low" : "medium"}">
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
          </div>
        </article>
      `;
    }).join("");

  identityEl.innerHTML =
    groupCards +
    (nonViolations
      ? '<div class="eyebrow" style="margin-top:24px">Confirmed / ambiguous samples</div>' + nonViolations
      : "");
}


function renderHypothesisExperiments(experiments) {
  const mismatches = experiments.filter(item => item.mismatch);
  hypothesisCount.textContent =
    `${experiments.length} experiments · ${mismatches.length} mismatches`;

  if (!experiments.length) {
    hypothesisEl.innerHTML =
      '<div class="empty">No target had enough compatible semantic inputs to generate competing hypotheses.</div>';
    return;
  }

  hypothesisEl.innerHTML = experiments
    .slice()
    .sort((a, b) => Number(b.mismatch) - Number(a.mismatch))
    .slice(0, 60)
    .map(item => {
      const perturbation = item.perturbation;
      const materiality = item.materiality;
      const prediction = (item.predictions || [])
        .find(pred => pred.hypothesisId === item.implementedHypothesisId);

      return `
        <article class="finding">
          <div class="severity ${item.mismatch ? (materiality?.rank === "critical" ? "critical" : "high") : item.status === "ambiguous" ? "medium" : "low"}">
            ${item.mismatch ? "mismatch" : esc(item.status)}
          </div>
          <h3>${esc(item.targetRole)} · ${esc(item.sheet)}!${esc(item.cell)}</h3>
          <p><strong>Preferred generated hypothesis:</strong> ${esc(item.preferredExpression)}</p>
          <p><strong>Implemented behavior:</strong> ${esc(item.implementedExpression || "not resolved")}</p>
          <p>${esc(item.explanation)}</p>
          ${perturbation ? `
            <div class="meta">
              Discriminating perturbation:
              <code>${esc(perturbation.key)}</code>
              +${esc((Number(perturbation.perturbationPercent) * 100).toFixed(1))}%
              · ${esc(perturbation.baselineValue)} → ${esc(perturbation.perturbedValue)}
            </div>
          ` : ""}
          <div class="meta">
            ${item.implementedMatchScore === undefined ? "" : "Implemented match: " + esc(Math.round(item.implementedMatchScore * 100)) + "%"}
            ${item.plausibilityGap === undefined ? "" : " · Plausibility gap: " + esc(Math.round(item.plausibilityGap * 100)) + "pp"}
            ${prediction?.normalizedError === undefined ? "" : " · prediction error: " + esc((prediction.normalizedError * 100).toFixed(1)) + "%"}
            ${materiality?.rank ? " · Materiality: " + esc(materiality.rank) : ""}
            ${materiality?.relativeImpact === undefined ? "" : " (" + esc((materiality.relativeImpact * 100).toFixed(1)) + "%)"}
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
    renderIdentities(
      data.identityAssessments || [],
      data.identityViolationGroups || []
    );
    renderHypothesisExperiments(data.hypothesisExperiments || []);
    renderTests(data.counterfactualTests || []);

    const build = data.build || {};
    const buildText = build.version
      ? ` · ERXL ${esc(build.version)} · commit <code>${esc(String(build.commit || "unknown").slice(0, 12))}</code> · built ${esc(build.builtAt || "unknown")}`
      : "";

    runMeta.innerHTML =
      `Run <code>${esc(data.runId)}</code> · storage: ${esc(data.persistence)} · ${esc(data.fileName)}${buildText}`;

    resultsEl.classList.remove("hidden");
    statusEl.textContent = "Analysis complete.";
  } catch (error) {
    statusEl.classList.add("error");
    statusEl.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    submit.disabled = false;
  }
});
