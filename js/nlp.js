/**
 * nlp.js — Pure browser-based NLP engine for document consistency checking.
 * No API key, no server, no external calls. Runs 100% offline.
 *
 * Capabilities:
 *  - Entity extraction (name, DOB, parent names, income, address, caste, school, class)
 *  - Levenshtein + token-set similarity scoring
 *  - Cross-document field comparison
 *  - Contextual fraud / logical consistency checks
 */

window.NLP = (() => {

  /* ── String Utilities ── */

  function normalize(str) {
    return (str || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function levenshtein(a, b) {
    a = normalize(a); b = normalize(b);
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    const m = a.length, n = b.length;
    let prev = Array.from({ length: n + 1 }, (_, i) => i);
    for (let i = 1; i <= m; i++) {
      const curr = [i];
      for (let j = 1; j <= n; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      }
      prev = curr;
    }
    return prev[n];
  }

  function similarityScore(a, b) {
    if (!a || !b) return 0;
    a = normalize(a); b = normalize(b);
    if (a === b) return 1.0;
    const maxLen = Math.max(a.length, b.length);
    if (maxLen === 0) return 1.0;
    const lev = levenshtein(a, b);
    const charSim = 1 - lev / maxLen;

    // Token-set similarity (handles "KRISHNAMURTHY K" vs "K KRISHNAMURTHY")
    const tokA = new Set(a.split(' ').filter(Boolean));
    const tokB = new Set(b.split(' ').filter(Boolean));
    const intersection = [...tokA].filter(t => tokB.has(t)).length;
    const union = new Set([...tokA, ...tokB]).size;
    const jaccardSim = union === 0 ? 0 : intersection / union;

    return Math.max(charSim, jaccardSim);
  }

  function isMatch(a, b, threshold = 0.85) {
    return similarityScore(a, b) >= threshold;
  }

  /* ── Entity Extraction ── */

  const PATTERNS = {
    // Name patterns
    name: [
      /(?:student\s*name|name of (?:the )?student|name)\s*[:\-]\s*([A-Z][A-Z\s\.]{3,50})/i,
      /(?:^|\n)\s*name\s*[:\-]\s*([A-Z][A-Z\s\.]{3,50})/im,
      /(?:this is to certify that|certify that)\s+(?:mr\.?|ms\.?|miss\.?)?\s*([A-Z][A-Z\s\.]{3,40})/i,
      /(?:shri|smt|mr|ms|miss)\.?\s+([A-Z][A-Z\s\.]{3,40})(?:\s+son|\s+daughter|\s+s\/o|\s+d\/o)/i,
      /name[:\-]\s*([A-Z\s\.]{5,50})/i,
    ],
    dob: [
      /(?:date of birth|d\.?o\.?b\.?|born on|birth date)\s*[:\-]?\s*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i,
      /(?:date of birth|d\.?o\.?b\.?)\s*[:\-]?\s*(\d{1,2}\s+\w+\s+\d{4})/i,
      /born\s*[:\-]?\s*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i,
      /dob[:\-]\s*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i,
    ],
    father: [
      /(?:father(?:'s)? name|s\/o|son of|father)\s*[:\-]\s*([A-Z][A-Z\s\.]{3,50})/i,
      /(?:name of (?:the )?father)\s*[:\-]\s*([A-Z][A-Z\s\.]{3,50})/i,
      /(?:^|\n)\s*father\s*[:\-]\s*([A-Z][A-Z\s\.]{3,50})/im,
      /father[:\-]\s*([A-Z\s\.]{3,50})/i,
    ],
    mother: [
      /(?:mother(?:'s)? name|d\/o|daughter of|mother)\s*[:\-]\s*([A-Z][A-Z\s\.]{3,50})/i,
      /(?:name of (?:the )?mother)\s*[:\-]\s*([A-Z][A-Z\s\.]{3,50})/i,
    ],
    income: [
      /(?:annual|family|yearly|total)?\s*income\s*[:\-]?\s*(?:rs\.?|inr|₹)?\s*([\d,]+)/i,
      /(?:rs\.?|inr|₹)\s*([\d,]+)\s*(?:\/\-|only|per annum|pa|per year)/i,
      /income[^\n]*?(?:rs\.?|inr|₹)\s*([\d,]+)/i,
    ],
    address: [
      /(?:address|resident of|residing at|permanent address)\s*[:\-]\s*([A-Za-z0-9,\s\/\-\.]{10,120})/i,
    ],
    caste: [
      /(?:community|caste|belongs to|sub.?caste)\s*[:\-]\s*([A-Z][A-Za-z\s]{2,40})/i,
    ],
    school: [
      /(?:school|institution|college)\s*[:\-]\s*([A-Z][A-Za-z\s\.\,\/]{5,80})/i,
    ],
    standard: [
      /(?:standard|class|std|grade)\s*[:\-]?\s*([IVX\d]+(?:th|st|nd|rd)?(?:\s*\(.*?\))?)/i,
      /(\d+th|\d+st|\d+nd|\d+rd|X|XII|XI|IX|VIII)\s+(?:standard|class|std)/i,
    ],
    yearPassing: [
      /(?:year of passing|passed|year)\s*[:\-]?\s*(20\d{2}|19\d{2})/i,
    ],
    certDate: [
      /(?:date of issue|issued on|date)\s*[:\-]\s*(\d{1,2}[\/\-\s]\w+[\/\-\s]\d{2,4}|\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i,
    ],
  };

  function extractField(text, fieldPatterns) {
    for (const pat of fieldPatterns) {
      const m = text.match(pat);
      if (m && m[1]) {
        return m[1].trim().replace(/\s+/g, ' ');
      }
    }
    return null;
  }

  function extractAllFields(text) {
    const fields = {};
    for (const [key, pats] of Object.entries(PATTERNS)) {
      const val = extractField(text, pats);
      if (val) fields[key] = val;
    }
    // Try to extract DOB year for age calculation
    if (fields.dob) {
      const yearMatch = fields.dob.match(/(\d{4})/);
      if (yearMatch) fields._dobYear = parseInt(yearMatch[1]);
    }
    // Parse income as number
    if (fields.income) {
      const num = parseInt(fields.income.replace(/,/g, ''));
      if (!isNaN(num)) fields._incomeNum = num;
    }
    return fields;
  }

  /* ── Date / Year Parsing ── */

  function parseYear(dobStr) {
    if (!dobStr) return null;
    const m = dobStr.match(/(\d{4})/);
    return m ? parseInt(m[1]) : null;
  }

  function dobToAge(dobStr, referenceYear = 2024) {
    const year = parseYear(dobStr);
    if (!year) return null;
    return referenceYear - year;
  }

  function normalizeDate(dateStr) {
    if (!dateStr) return null;
    const clean = dateStr.replace(/[-.\s]/g, '/');
    const parts = clean.split('/');
    if (parts.length >= 3) {
      // try to get DD/MM/YYYY
      let day = parseInt(parts[0]);
      let mon = parseInt(parts[1]);
      let yr  = parts[2].length === 2 ? 2000 + parseInt(parts[2]) : parseInt(parts[2]);
      if (!isNaN(day) && !isNaN(mon) && !isNaN(yr)) {
        return `${String(day).padStart(2,'0')}/${String(mon).padStart(2,'0')}/${yr}`;
      }
    }
    return dateStr;
  }

  function datesMatch(d1, d2) {
    if (!d1 || !d2) return null; // can't compare
    return normalizeDate(d1) === normalizeDate(d2);
  }

  /* ── Cross-Document Analysis ── */

  function analyzeDocuments(documents) {
    // documents: [{title, content, fields}]
    const result = {
      extracted_fields: {},
      field_comparisons: [],
      flags: [],
      summary: { critical_count: 0, warning_count: 0, ok_count: 0, info_count: 0 }
    };

    // Store extracted fields
    documents.forEach(doc => {
      result.extracted_fields[doc.title] = { ...doc.fields };
    });

    // ── 1. Name Comparisons ──
    comparePairwiseField(documents, 'name', 'Student Name', result, 0.82);

    // ── 2. DOB Comparisons ──
    comparePairwiseField(documents, 'dob', 'Date of Birth', result, 0.90);

    // ── 3. Father's Name ──
    comparePairwiseField(documents, 'father', "Father's Name", result, 0.82);

    // ── 4. Mother's Name ──
    comparePairwiseField(documents, 'mother', "Mother's Name", result, 0.82);

    // ── 5. Address ──
    comparePairwiseField(documents, 'address', 'Address', result, 0.75);

    // ── 6. Age-Grade Consistency ──
    checkAgeGrade(documents, result);

    // ── 7. Income Plausibility ──
    checkIncomePlausibility(documents, result);

    // ── 8. Date Ordering / Anomalies ──
    checkDateAnomalies(documents, result);

    // ── 9. Property / Lifestyle vs Income ──
    checkLifestyleIncomeConflict(documents, result);

    // Tally summary
    result.flags.forEach(f => {
      if (f.severity === 'critical') result.summary.critical_count++;
      else if (f.severity === 'warning') result.summary.warning_count++;
      else if (f.severity === 'ok') result.summary.ok_count++;
      else result.summary.info_count++;
    });

    // Verdict
    if (result.summary.critical_count >= 2) {
      result.summary.verdict = 'REJECT';
      result.summary.verdict_reason = `${result.summary.critical_count} critical inconsistencies detected across documents.`;
    } else if (result.summary.critical_count === 1 || result.summary.warning_count >= 2) {
      result.summary.verdict = 'NEEDS_REVIEW';
      result.summary.verdict_reason = 'One or more significant discrepancies require manual verification.';
    } else {
      result.summary.verdict = 'PASS';
      result.summary.verdict_reason = 'All key fields are consistent across submitted documents.';
    }

    return result;
  }

  function comparePairwiseField(documents, fieldKey, fieldLabel, result, threshold) {
    const docsWithField = documents.filter(d => d.fields[fieldKey]);
    if (docsWithField.length < 2) return;

    // Compare first two docs that have the field
    const d1 = docsWithField[0], d2 = docsWithField[1];
    const v1 = d1.fields[fieldKey], v2 = d2.fields[fieldKey];
    const score = similarityScore(v1, v2);
    const matched = score >= threshold;

    const values = {};
    values[d1.title] = v1;
    values[d2.title] = v2;

    result.field_comparisons.push({
      field: fieldLabel,
      values,
      match: matched,
      similarity_score: parseFloat(score.toFixed(2)),
      note: matched ? '' : `"${v1}" vs "${v2}" — similarity ${Math.round(score * 100)}%`
    });

    if (!matched) {
      const isCritical = fieldKey === 'dob' || (fieldKey === 'name' && score < 0.6);
      result.flags.push({
        severity: isCritical ? 'critical' : 'warning',
        category: fieldKey === 'name' ? 'Name Mismatch'
                : fieldKey === 'dob'  ? 'Date of Birth Mismatch'
                : 'Cross-Document Mismatch',
        title: `${fieldLabel} mismatch between "${d1.title}" and "${d2.title}"`,
        description: `"${d1.title}" records ${fieldLabel} as "${v1}", but "${d2.title}" records it as "${v2}". Similarity score: ${Math.round(score * 100)}%. This ${isCritical ? 'critical discrepancy' : 'discrepancy'} requires verification.`
      });
    } else {
      result.flags.push({
        severity: 'ok',
        category: 'Semantic Similarity',
        title: `${fieldLabel} consistent (${Math.round(score * 100)}% match)`,
        description: `"${v1}" in "${d1.title}" matches "${v2}" in "${d2.title}" with a similarity score of ${Math.round(score * 100)}%.`
      });
    }
  }

  function checkAgeGrade(documents, result) {
    let dobYear = null, standard = null, dobSource = '', stdSource = '';

    documents.forEach(doc => {
      if (!dobYear && doc.fields.dob) {
        const y = parseYear(doc.fields.dob);
        if (y) { dobYear = y; dobSource = doc.title; }
      }
      if (!standard && doc.fields.standard) {
        standard = doc.fields.standard;
        stdSource = doc.title;
      }
    });

    if (!dobYear || !standard) return;

    const age = 2024 - dobYear; // reference year 2024
    const stdLower = standard.toLowerCase();

    let expectedMinAge = null, expectedMaxAge = null, stdNum = null;
    if (stdLower.includes('xii') || stdLower.includes('12')) { stdNum = 12; expectedMinAge = 16; expectedMaxAge = 20; }
    else if (stdLower.includes('xi') || stdLower.includes('11')) { stdNum = 11; expectedMinAge = 15; expectedMaxAge = 19; }
    else if (stdLower.includes('x') || stdLower.includes('10')) { stdNum = 10; expectedMinAge = 14; expectedMaxAge = 18; }
    else if (stdLower.includes('ix') || stdLower.includes('9')) { stdNum = 9; expectedMinAge = 13; expectedMaxAge = 17; }

    if (expectedMinAge === null) return;

    if (age < expectedMinAge || age > expectedMaxAge) {
      result.flags.push({
        severity: 'critical',
        category: 'Age-Grade Inconsistency',
        title: `Student age (${age}) is inconsistent with ${standard} standard`,
        description: `DOB from "${dobSource}" gives an age of approximately ${age} years. Students in ${standard} standard are typically ${expectedMinAge}–${expectedMaxAge} years old. This is a significant red flag that may indicate falsified DOB or incorrect class information.`
      });
    } else {
      result.flags.push({
        severity: 'ok',
        category: 'Age-Grade Consistency',
        title: `Student age (${age}) is appropriate for ${standard} standard`,
        description: `Calculated age of ${age} years falls within the expected range of ${expectedMinAge}–${expectedMaxAge} for ${standard} standard. No anomaly detected.`
      });
    }
  }

  function checkIncomePlausibility(documents, result) {
    const incomeDoc = documents.find(d => d.fields._incomeNum);
    if (!incomeDoc) return;

    const income = incomeDoc.fields._incomeNum;
    const text   = (incomeDoc.content || '').toLowerCase();

    const LUXURY_KEYWORDS = [
      'vehicle', 'car', 'two-wheeler', 'bike', 'motorcycle', 'scooter',
      '3-bedroom', 'three bedroom', '3 bedroom', 'bungalow', 'villa',
      'business', 'proprietor', 'plot', 'land acres', 'registered vehicle',
      'commercial', 'factory'
    ];

    const found = LUXURY_KEYWORDS.filter(kw => text.includes(kw));

    if (income < 150000 && found.length > 0) {
      result.flags.push({
        severity: 'critical',
        category: 'Income Inconsistency',
        title: `Stated income (₹${income.toLocaleString()}) conflicts with asset indicators`,
        description: `"${incomeDoc.title}" states annual family income of ₹${income.toLocaleString()}, which qualifies as low-income. However, the document or associated records mention: ${found.join(', ')}. Ownership of these assets is typically inconsistent with stated income. This is a strong fraud indicator.`
      });
    } else if (income < 60000) {
      result.flags.push({
        severity: 'info',
        category: 'Income Inconsistency',
        title: `Very low income declared (₹${income.toLocaleString()}/year)`,
        description: `Family income declared at ₹${income.toLocaleString()} per annum. While this may be genuine, it is advisable to cross-verify with field enquiry or bank statements.`
      });
    } else if (income >= 500000) {
      result.flags.push({
        severity: 'warning',
        category: 'Income Inconsistency',
        title: `High income on income certificate may affect eligibility`,
        description: `Declared income of ₹${income.toLocaleString()} exceeds typical thresholds for OBC/SC/ST income-based reservations and scholarships. Verify whether the student is applying under an income-based quota.`
      });
    } else {
      result.flags.push({
        severity: 'ok',
        category: 'Income Inconsistency',
        title: `Income declaration (₹${income.toLocaleString()}) appears plausible`,
        description: `No obvious lifestyle or asset indicators conflict with the stated annual income of ₹${income.toLocaleString()}.`
      });
    }
  }

  function checkDateAnomalies(documents, result) {
    let dobYear = null;
    documents.forEach(doc => {
      if (!dobYear && doc.fields.dob) {
        const y = parseYear(doc.fields.dob);
        if (y) dobYear = y;
      }
    });

    documents.forEach(doc => {
      if (!doc.fields.certDate) return;
      const certYear = parseYear(doc.fields.certDate);
      if (!certYear) return;

      if (dobYear && certYear < dobYear) {
        result.flags.push({
          severity: 'critical',
          category: 'Date Anomaly',
          title: `Certificate date (${certYear}) is before student's birth year (${dobYear})`,
          description: `"${doc.title}" was reportedly issued in ${certYear}, but the student's DOB indicates birth in ${dobYear}. A certificate cannot predate the student's birth. This is a critical inconsistency.`
        });
      } else if (certYear > 2025) {
        result.flags.push({
          severity: 'warning',
          category: 'Date Anomaly',
          title: `Certificate date appears to be in the future (${certYear})`,
          description: `"${doc.title}" has an issue date of ${certYear}, which is in the future. This may be a data entry error or a forged backdated certificate.`
        });
      } else if (certYear < 2000) {
        result.flags.push({
          severity: 'warning',
          category: 'Date Anomaly',
          title: `Certificate date is unusually old (${certYear})`,
          description: `"${doc.title}" has an issue date of ${certYear}. Verify whether this is correct or a transcription error.`
        });
      }
    });
  }

  function checkLifestyleIncomeConflict(documents, result) {
    // Check if DOB differs across documents
    const dobValues = documents
      .filter(d => d.fields.dob)
      .map(d => ({ dob: normalizeDate(d.fields.dob), title: d.title }));

    if (dobValues.length >= 2) {
      const uniqueDobs = [...new Set(dobValues.map(d => d.dob))];
      if (uniqueDobs.length > 1) {
        const pairs = dobValues.map(d => `${d.title}: ${d.dob}`).join(' | ');
        result.flags.push({
          severity: 'critical',
          category: 'Date of Birth Mismatch',
          title: `Date of Birth differs across documents`,
          description: `DOB values are inconsistent: ${pairs}. Even a one-year difference is a critical red flag that may indicate document tampering to appear younger/older for quota eligibility.`
        });
      }
    }

    // Check name missing initials / truncation
    const nameValues = documents.filter(d => d.fields.name).map(d => ({ n: d.fields.name, t: d.title }));
    if (nameValues.length >= 2) {
      for (let i = 0; i < nameValues.length - 1; i++) {
        for (let j = i + 1; j < nameValues.length; j++) {
          const sc = similarityScore(nameValues[i].n, nameValues[j].n);
          if (sc >= 0.55 && sc < 0.82) {
            result.flags.push({
              severity: 'warning',
              category: 'Name Mismatch',
              title: `Partial name match between "${nameValues[i].t}" and "${nameValues[j].t}"`,
              description: `"${nameValues[i].n}" vs "${nameValues[j].n}" — similarity is ${Math.round(sc * 100)}%. Possible missing initial, different spelling, or abbreviated name. Manual verification recommended.`
            });
          }
        }
      }
    }
  }

  /* ── Public API ── */
  return {
    extractAllFields,
    analyzeDocuments,
    similarityScore,
    normalize,
  };

})();
