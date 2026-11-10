/* ============================================================
   formatter.js — Motor de formateo y coloreado de SQL
   ============================================================ */
'use strict';

const KEYWORDS = new Set(`
SELECT FROM WHERE GROUP ORDER BY HAVING LIMIT OFFSET UNION ALL INTERSECT EXCEPT VALUES SET INSERT INTO UPDATE DELETE MERGE WITH
AS DISTINCT TOP JOIN INNER LEFT RIGHT FULL OUTER CROSS APPLY ON AND OR NOT NULL IN IS LIKE BETWEEN EXISTS CASE WHEN THEN ELSE END
CREATE TABLE ALTER DROP INDEX VIEW PRIMARY KEY FOREIGN REFERENCES DEFAULT CHECK UNIQUE CONSTRAINT ADD COLUMN ASC DESC IF BEGIN COMMIT
ROLLBACK TRANSACTION TRAN DECLARE EXEC EXECUTE PROCEDURE RETURNS RETURN WHILE LOOP FOR CURSOR FETCH OPEN CLOSE PRINT GRANT
REVOKE USE GO TRUNCATE OVER PARTITION WINDOW FILTER RECURSIVE ROLLUP CUBE GROUPING ONLY NEXT ROWS COLLATE ESCAPE
INT INTEGER BIGINT SMALLINT TINYINT BIT BOOLEAN BOOL SERIAL BIGSERIAL VARCHAR NVARCHAR CHAR NCHAR TEXT NTEXT DATE DATETIME DATETIME2
SMALLDATETIME TIME TIMESTAMP DECIMAL NUMERIC FLOAT REAL DOUBLE PRECISION MONEY SMALLMONEY XML JSON JSONB UUID BLOB CLOB IMAGE
UNIQUEIDENTIFIER VARBINARY BINARY ROWVERSION
COUNT SUM AVG MIN MAX COALESCE NULLIF CAST CONVERT SUBSTRING LEN LENGTH UPPER LOWER TRIM LTRIM RTRIM REPLACE CONCAT CONCAT_WS ISNULL
IFNULL GETDATE SYSDATETIME DATEADD DATEDIFF DATENAME DATEPART YEAR MONTH DAY NOW CURRENT_TIMESTAMP CURRENT_DATE CURRENT_TIME
ROW_NUMBER RANK DENSE_RANK NTILE LEAD LAG FIRST_VALUE LAST_VALUE ABS ROUND CEILING CEIL FLOOR POWER SQRT MOD EXP LOG LOG10 LN PI
CHARINDEX PATINDEX STUFF FORMAT IIF CHOOSE TRY_CAST TRY_CONVERT ISDATE ISNUMERIC NEWID
`.split(/\s+/).filter(Boolean));

const FUNCTIONS = new Set(`
COUNT SUM AVG MIN MAX COALESCE NULLIF CAST CONVERT SUBSTRING LEN LENGTH UPPER LOWER TRIM LTRIM RTRIM REPLACE CONCAT CONCAT_WS ISNULL
IFNULL GETDATE SYSDATETIME DATEADD DATEDIFF DATENAME DATEPART YEAR MONTH DAY NOW ROW_NUMBER RANK DENSE_RANK NTILE LEAD LAG
FIRST_VALUE LAST_VALUE ABS ROUND CEILING CEIL FLOOR POWER SQRT MOD EXP LOG LOG10 LN PI CHARINDEX PATINDEX STUFF FORMAT IIF CHOOSE
TRY_CAST TRY_CONVERT ISDATE ISNUMERIC NEWID LEFT RIGHT
`.split(/\s+/).filter(Boolean));

const CLAUSE_START = new Set(['SELECT', 'FROM', 'WHERE', 'HAVING', 'LIMIT', 'OFFSET', 'UNION', 'INTERSECT', 'EXCEPT',
  'VALUES', 'SET', 'INSERT', 'UPDATE', 'DELETE', 'MERGE', 'WITH', 'TRUNCATE', 'FETCH']);

/* ------------------------------ Léxico ------------------------------ */

function tokenize(sql, keepWs) {
  const tokens = [];
  const re = /(--[^\n]*)|(\/\*[\s\S]*?\*\/)|('(?:[^']|'')*'|"(?:[^"]|"")*"|`[^`]*`|N'(?:[^']|'')*')|(\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)|(\[[^\]]*\]|[A-Za-z_@#][\w@$#]*)|(<=|>=|<>|!=|==|\|\||::|->>|->|#>>|#>|:=|[-+*/%=<>!~&|^?:])|([(),;.])|(\s+)|(.)/g;
  let m;
  while ((m = re.exec(sql))) {
    if (m[1] || m[2]) tokens.push({ type: 'comment', value: m[0] });
    else if (m[3]) tokens.push({ type: 'string', value: m[0] });
    else if (m[4]) tokens.push({ type: 'number', value: m[0] });
    else if (m[5]) tokens.push({ type: KEYWORDS.has(m[5].toUpperCase()) ? 'keyword' : 'identifier', value: m[5] });
    else if (m[6]) tokens.push({ type: 'operator', value: m[0] });
    else if (m[7]) tokens.push({ type: 'punct', value: m[0] });
    else if (m[8] && keepWs) tokens.push({ type: 'ws', value: m[0] });
  }
  return tokens;
}

/* ---------------------------- Formateador ---------------------------- */

function formatSql(sql, opts) {
  const tokens = tokenize(sql);
  if (opts.mode === 'minify') return minifySql(tokens, opts);

  const ind = opts.indent === 'tab' ? '\t' : ' '.repeat(parseInt(opts.indent, 10));
  const lines = [];
  let cur = '';
  let indentLevel = 0;
  const parenStack = [];   // 'inline' | 'block' (subconsulta) | 'inlist'
  const caseStack = [];
  let betweenPending = false;
  let noSpaceNext = false;

  const kwc = w => opts.keywordCase === 'upper' ? w.toUpperCase()
                 : opts.keywordCase === 'lower' ? w.toLowerCase() : w;

  function newline(extra) {
    extra = extra || 0;
    lines.push(cur.replace(/[ \t]+$/g, ''));
    cur = ind.repeat(Math.max(0, indentLevel + extra));
  }
  function append(text, space) {
    if (space !== false && cur.trim().length && !noSpaceNext && !/[ \t]$/.test(cur)) cur += ' ';
    cur += text;
    noSpaceNext = false;
  }

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const prev = tokens[i - 1];
    const prev2 = tokens[i - 2];
    const next = tokens[i + 1];

    if (t.type === 'comment') {
      if (!opts.preserveComments) continue;
      if (cur.trim()) newline();
      append(t.value, false);
      newline();
      continue;
    }

    if (t.type === 'punct') {
      if (t.value === ';') {
        append(';', false);
        indentLevel = 0;
        parenStack.length = 0;
        for (let b = 0; b < opts.statementBreaks; b++) newline();
        continue;
      }
      if (t.value === '(') {
        const isSubquery = next && next.type === 'keyword' && /^(SELECT|WITH)$/i.test(next.value);
        const isInList = !isSubquery && opts.expandInLists && prev && prev.type === 'keyword' && prev.value.toUpperCase() === 'IN';
        const afterClauseKw = prev && prev.type === 'identifier' && prev2 && prev2.type === 'keyword'
          && /^(INTO|FROM|JOIN|UPDATE|TABLE|APPLY|TRUNCATE)$/i.test(prev2.value);
        const fnCall = !afterClauseKw && prev && (prev.type === 'identifier'
          || (prev.type === 'keyword' && FUNCTIONS.has(prev.value.toUpperCase())));
        append('(', !fnCall);
        if (isSubquery) { parenStack.push('block'); indentLevel++; newline(); }
        else if (isInList) { parenStack.push('inlist'); indentLevel++; newline(); }
        else { parenStack.push('inline'); noSpaceNext = true; }
        continue;
      }
      if (t.value === ')') {
        const kind = parenStack.pop() || 'inline';
        if (kind === 'inline') { append(')', false); }
        else { indentLevel = Math.max(0, indentLevel - 1); newline(); append(')', false); }
        continue;
      }
      if (t.value === ',') {
        const top = parenStack[parenStack.length - 1];
        const breakIt = top === 'inlist' || (opts.expandCommaLists && !parenStack.includes('inline'));
        if (breakIt) {
          const extra = top === 'inlist' ? 0 : 1;
          if (opts.trailingCommas) { append(',', false); newline(extra); }
          else { newline(extra); append(',', false); }
        } else {
          append(',', false);
          if (!opts.spaceAfterComma) noSpaceNext = true;
        }
        continue;
      }
      if (t.value === '.') { append('.', false); noSpaceNext = true; continue; }
    }

    if (t.type === 'operator') {
      if (t.value === '::') { append('::', false); noSpaceNext = true; continue; }
      const unary = (t.value === '-' || t.value === '+') &&
        (!prev || prev.type === 'operator' || (prev.type === 'punct' && prev.value !== ')') || prev.type === 'keyword');
      append(t.value);
      if (unary) noSpaceNext = true;
      continue;
    }

    if (t.type === 'keyword') {
      const w = t.value.toUpperCase();

      if ((w === 'GROUP' || w === 'ORDER') && next && next.type === 'keyword' && next.value.toUpperCase() === 'BY') {
        if (!parenStack.includes('inline') && cur.trim()) newline();
        append(kwc(w) + ' ' + kwc('BY'), false);
        i++;
        continue;
      }
      if (CLAUSE_START.has(w)) {
        if (!parenStack.includes('inline') && cur.trim()) newline();
        append(kwc(t.value), false);
        if (w === 'UNION' && next && next.type === 'keyword' && /^(ALL|DISTINCT)$/i.test(next.value)) { append(kwc(next.value)); i++; }
        else if ((w === 'INSERT' || w === 'DELETE') && next && next.type === 'keyword' && /^(INTO|FROM)$/i.test(next.value)) { append(kwc(next.value)); i++; }
        else if (w === 'SELECT' && opts.expandCommaLists) {
          if (next && next.type === 'keyword' && /^(DISTINCT|ALL|TOP)$/i.test(next.value)) { append(kwc(next.value)); i++; }
          newline(1);
        }
        continue;
      }
      if (w === 'OUTER' && prev && prev.type === 'keyword' && /^(LEFT|RIGHT|FULL)$/i.test(prev.value)) {
        append(kwc(t.value));
        continue;
      }
      if (/^(LEFT|RIGHT|FULL|INNER|CROSS|OUTER)$/.test(w)) {
        let j = i + 1;
        if (w !== 'OUTER' && tokens[j] && tokens[j].type === 'keyword' && tokens[j].value.toUpperCase() === 'OUTER') j++;
        if (tokens[j] && tokens[j].type === 'keyword' && /^(JOIN|APPLY)$/.test(tokens[j].value.toUpperCase())) {
          if (cur.trim()) newline();
          append(kwc(t.value), false);
        } else {
          append(kwc(t.value));
        }
        continue;
      }
      if (w === 'JOIN' || w === 'APPLY') {
        const prevMod = prev && prev.type === 'keyword' && /^(LEFT|RIGHT|FULL|INNER|CROSS|OUTER)$/i.test(prev.value);
        if (!prevMod && cur.trim()) newline();
        append(kwc(t.value));
        continue;
      }
      if (w === 'ON') {
        if (opts.breakJoinOn) { newline(1); append(kwc(t.value), false); }
        else append(kwc(t.value));
        continue;
      }
      if (w === 'AND' || w === 'OR') {
        if (w === 'AND' && betweenPending && !opts.expandBetween) {
          append(kwc(t.value));
          betweenPending = false;
          continue;
        }
        betweenPending = false;
        if (opts.expandBoolean) { newline(1); append(kwc(t.value), false); }
        else append(kwc(t.value));
        continue;
      }
      if (w === 'BETWEEN') { append(kwc(t.value)); betweenPending = true; continue; }
      if (w === 'CASE' && opts.expandCase) {
        append(kwc(t.value));
        caseStack.push(true);
        indentLevel++;
        continue;
      }
      if (w === 'WHEN' && opts.expandCase && caseStack.length) {
        newline(1);
        append(kwc(t.value), false);
        continue;
      }
      if (w === 'ELSE' && opts.expandCase && caseStack.length) {
        newline(1);
        append(kwc(t.value), false);
        continue;
      }
      if (w === 'END' && opts.expandCase && caseStack.length) {
        caseStack.pop();
        indentLevel = Math.max(0, indentLevel - 1);
        newline(1);
        append(kwc(t.value), false);
        continue;
      }
      append(kwc(t.value));
      continue;
    }

    append(t.value);
  }

  lines.push(cur.replace(/[ \t]+$/g, ''));
  while (lines.length && lines[0] === '') lines.shift();
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n');
}

/* ---------------------------- Minificador ---------------------------- */

function minifySql(tokens, opts) {
  const kwc = w => opts.keywordCase === 'upper' ? w.toUpperCase()
                 : opts.keywordCase === 'lower' ? w.toLowerCase() : w;
  let out = '';
  let prev = null;
  for (const t of tokens) {
    if (t.type === 'comment') {
      if (opts.preserveComments) out += (out && !out.endsWith(' ') ? ' ' : '') + t.value + ' ';
      continue;
    }
    const v = t.type === 'keyword' ? kwc(t.value) : t.value;
    const noSpaceBefore = /^[),;.]$/.test(v) ||
      (v === '(' && prev && (prev.type === 'identifier' ||
        (prev.type === 'keyword' && FUNCTIONS.has(prev.value.toUpperCase()))));
    const prevNoSpaceAfter = prev && /^[(.]$/.test(prev.value);
    if (out && !out.endsWith(' ') && !noSpaceBefore && !prevNoSpaceAfter) out += ' ';
    out += v;
    prev = t;
  }
  return out.trim();
}

/* ---------------------------- Coloreado ---------------------------- */

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function sqlToHtml(text, color) {
  if (!color) return escapeHtml(text);
  return tokenize(text, true).map(t => {
    const v = escapeHtml(t.value);
    if (t.type === 'keyword') {
      return FUNCTIONS.has(t.value.toUpperCase())
        ? '<span class="fn">' + v + '</span>'
        : '<span class="kw">' + v + '</span>';
    }
    if (t.type === 'string') return '<span class="str">' + v + '</span>';
    if (t.type === 'comment') return '<span class="cm">' + v + '</span>';
    if (t.type === 'number') return '<span class="num">' + v + '</span>';
    return v;
  }).join('');
}
