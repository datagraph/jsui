# Concepts in james/finto and james/fibo: a SKOS thesaurus collection set against a FIBO ontology fragment

## Summary
The two stores do not hold the same kind of thing. **james/finto** is a large collection of SKOS indexing thesauri. It has 96,797 `skos:Concept` instances, in Finnish, Swedish and English, held in the AFO, Allärs and Avoindata.fi schemes and linked by `skos:broader`, `skos:narrower` and `skos:related`. **james/fibo** is a small OWL fragment of the FIBO financial ontology. It has 4 `owl:Class`, 7 `owl:Restriction`, 1 `owl:DatatypeProperty` and 2 `owl:Ontology`. Its classes are defined by axioms (`rdfs:subClassOf`, qualified-cardinality and `someValuesFrom` restrictions), not by thesaurus relations.

Comparing them therefore means asking which of FIBO's 3 labelled classes have a counterpart among finto's indexing terms. I found plausible counterparts for all three, but they are only approximate. finto terms are subject headings for retrieval, while FIBO classes state what an individual must be. I found no explicit links between the stores.

## 1. Inventory
**james/fibo**, from `catalog {scope: types}` and `catalog {scope: predicates}`:
- Types: `owl:Class` 4, `owl:Restriction` 7, `owl:Ontology` 2, `owl:DatatypeProperty` 1.
- Predicates: 24 in all. They include `rdfs:subClassOf` (10), `owl:onProperty` (7), `owl:imports` (13), `skos:definition` (4), `skos:changeNote` (9), and one each of `owl:qualifiedCardinality` and `skos:example`.
- The two ontologies are "Classification Schemes Ontology" (FND/Arrangements/ClassificationSchemes) and "Commercial Loans Ontology" (LOAN/LoansSpecific/CommercialLoans). Their version IRIs are under `.../master/2026Q3/`.
- The labelled classes are:
  - "industry sector classification scheme", a subclass of `cmns-cls:ClassificationScheme`;
  - "industry sector classifier", a subclass of `cmns-cls:Classifier`;
  - "commercial loan"@en, a subclass of `fibo-loan:Loan`, with synonym "commercial and industrial loan".
- The 4th `owl:Class` has no label, definition or `isDefinedBy`.
- The restrictions are on these properties: `isDefinedIn`, `defines` (×2), `hasBusinessPurposeDescription`, `isPlayedBy`, `hasBorrower` and `hasObjective`. The `someValuesFrom` targets that resolved are `IndustrySectorClassifier` and `cmns-org:LegalEntity`; the `hasBorrower` target is a blank node.
- The datatype property is "has business purpose description". Its domain is `CommercialLoan` and it is a subproperty of `cmns-dsg:hasDescription`.

**james/finto**, from `catalog` and `profile skos:Concept`:
- Types: `skos:Concept` 96,797, `afo-meta:Concept` 11,980, `allars-meta:GeographicalConcept` 6,260, `skos:Collection` 475, `skos-thes:ThesaurusArray` 414, `skosext:DeprecatedConcept` 164, `skos:ConceptScheme` 10, `void:Dataset` 39, `owl:Class` 3.
- Named graphs: `yso.fi/onto/afo/`, `yso.fi/onto/allars/`, `avoindata.fi/onto/contentType/`, `avoindata.fi/onto/topic/`, and the default graph.
- Values of `skos:inScheme`: afo/, afo/deprecatedconceptscheme, afo/aggregateconceptscheme, allars/, avoindata contentType, avoindata topic, and `dydra.com/#categories`.
- Relation counts on concepts:

| Predicate | Count |
|---|---|
| `skos:prefLabel` | 369,601 |
| `skos:related` | 152,440 |
| `skos:broader` / `skos:narrower` | 147,987 each |
| `skos:altLabel` | 75,445 |
| `skos:exactMatch` | 46,725 |
| `skos:closeMatch` | 26,620 |
| `skos:definition` | 52 |

The 46,725 `exactMatch` links seen in my sample point to `yso.fi/onto/yso/...`.

## 2. Candidate correspondences
The categories below ("close", "broader-ish", "related-ish") are **my own judgement**. They are not SKOS or OWL assertions, and none has been validated.

| FIBO class (james/fibo) | finto concept(s) (james/finto, scheme afo/) | My category | Confidence | Reason |
|---|---|---|---|---|
| industry sector classification scheme | "classification of economic activities"@en (broader: "classifications") | close | medium | FIBO's own `skos:example` names NACE, NAICS and SIC, which are classifications of economic activities. But finto's term is a subject heading, not a class of schemes. |
| industry sector classification scheme | "classification schemes"@en (broader: "classification systems") | broader-ish | medium-low | This is the general notion. The finto term has no industry restriction. |
| industry sector classifier | "lines of activity"@en (fi "toimialat", sv "branscher"); "business sector"@en, whose broader is "lines of activity" | related-ish | low | finto's terms name the sectors themselves (narrower terms include "banking sector", "film industry" and "agricultural sector"). FIBO's class is the *classifier* that a scheme assigns to an organisation. These sit at different levels of abstraction. |
| commercial loan | "loans (amount of money)"@en (broader: "economic phenomena") | broader-ish | medium | A commercial loan is a kind of loan. I found no finto concept for commercial, business, corporate or company loans. |
| commercial loan | "capital loans", "short-term loans", "shareholder loans", "credit institutions" (all @en) | related-ish | low | These were found by a regex search on labels. Their hierarchies were not inspected. |

Terms that resemble the FIBO labels but should **not** be matched, because they belong to other senses in finto:
- "lending"@en has the broader term "library services".
- "loans (loaned object)", "loanwords" and "loan translations".
- "corn loans" ("viljalainat"/"spannmålslån").

## 3. The main difference: what the terms are
- **finto terms** are multilingual SKOS concepts used to index documents. They are organised by `broader`/`narrower`/`related`. Definitions are rare (52 in the whole store), and their meaning is carried by their labels and their place in the hierarchy.
- **FIBO terms** are OWL classes with formal semantics. For example, "commercial loan" is a subclass of `Loan` plus three anonymous restrictions: on `hasBorrower` (some value from a blank-node class), and on `hasObjective` and `hasBusinessPurposeDescription`. Each class has a natural-language `skos:definition`.
- So a finto concept can at most be *about* the same subject as a FIBO class. Linking them with `skos:exactMatch` would wrongly treat a subject heading as a class definition.
- Scale is also very different. finto has about 97k concepts across general, agriculture and forestry, and open-data topics. The fibo store has 3 labelled classes from 2 FIBO modules. This export does not represent FIBO as a whole.

## 4. Operations used
**james/fibo**
- `catalog {scope: types}` and `catalog {scope: predicates}`.
- `profile owl:Class`.
- `select {@type: owl:Class, @shape: [rdfs:label, skos:definition, rdfs:isDefinedBy]}`.
- `select {@type: owl:Restriction, @shape: [owl:onProperty, owl:someValuesFrom]}`.
- `select {@type: owl:DatatypeProperty, ...}`.
- The compiled SPARQL for the subclass query (n6), as it ran:
```
SELECT ?RDFS_LABEL ?RDFS_SUBCLASSOF ?RDFS_LABEL ?RDFS_SUBCLASSOF
 FROM <urn:dydra:all> WHERE { { { { ?S <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://www.w3.org/2002/07/owl#Class> .
   ?S <http://www.w3.org/2000/01/rdf-schema#label> ?RDFS_LABEL .
   ?S <http://www.w3.org/2000/01/rdf-schema#subClassOf> ?RDFS_SUBCLASSOF }
 OPTIONAL { ?S <http://www.w3.org/2000/01/rdf-schema#label> ?RDFS_LABEL } }}
 OPTIONAL { ?S <http://www.w3.org/2000/01/rdf-schema#subClassOf> ?RDFS_SUBCLASSOF } }}}
 OFFSET 0 LIMIT 30
```

**james/finto**
- `catalog {scope: types}`, `catalog {scope: graphs}` and `profile skos:Concept`.
- A distinct `prefLabel` select narrowed by the regex `loan|credit|lending|industr(y|ies) sector|classification|sector`, which returned 81 rows.
- A select with `broader` narrowed to the candidate labels. Its compiled SPARQL (n13), as it ran:
```
SELECT DISTINCT ?SKOS_PREFLABEL ?SKOS_INSCHEME ?SKOS_BROADER_SKOS_PREFLABEL
 FROM <urn:dydra:all> WHERE { { { ?S <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://www.w3.org/2004/02/skos/core#Concept> .
   ?S <http://www.w3.org/2004/02/skos/core#prefLabel> ?SKOS_PREFLABEL .
   ?S <http://www.w3.org/2004/02/skos/core#inScheme> ?SKOS_INSCHEME .
   ?S <http://www.w3.org/2004/02/skos/core#broader> ?SKOS_BROADER .
   ?SKOS_BROADER <http://www.w3.org/2004/02/skos/core#prefLabel> ?SKOS_BROADER_SKOS_PREFLABEL } FILTER
 ( regex(( str(?SKOS_PREFLABEL)), '^(loans \\(amount of money\\)|classification of economic activities|classification schemes|business sector|lending|credit institutions|corporate loans|company loans)$')) }}
 OFFSET 0 LIMIT 60
```
- A `narrower` select for "lines of activity", capped at 60 rows.

---

### Observed
- **james/fibo:**
  - 4 `owl:Class`, 7 `owl:Restriction`, 2 `owl:Ontology` and 1 `owl:DatatypeProperty`, using 24 distinct predicates.
  - 3 labelled classes: "industry sector classification scheme", "industry sector classifier" and "commercial loan"@en.
  - The 4th class has no label, definition or `isDefinedBy`.
  - The restrictions are on `defines`, `isDefinedIn`, `isPlayedBy` (some `LegalEntity`), `hasBorrower`, `hasObjective` and `hasBusinessPurposeDescription`.
  - The two ontologies are Classification Schemes and Commercial Loans, both 2026Q3.
- **james/finto:**
  - 96,797 `skos:Concept`, 10 `skos:ConceptScheme`, 475 `skos:Collection`, 11,980 `afo-meta:Concept` and 6,260 `allars-meta:GeographicalConcept`.
  - Graphs: afo, allars and the two Avoindata.fi graphs.
  - Labels are in fi, sv and en.
  - These concepts exist, all with scheme afo/: "classification of economic activities" (broader: "classifications"), "classification schemes", "loans (amount of money)" (broader: "economic phenomena"), "business sector" (broader: "lines of activity"), "lending" (broader: "library services") and "credit institutions".
  - "lines of activity" has narrower terms including "banking sector", "financial management", "film industry" and "agricultural sector".
  - My label search found no label containing "commercial loan".
  - The `exactMatch` targets I sampled were YSO IRIs.

### Interpreted
- The stores model concepts in different ways: finto as SKOS thesaurus concepts for indexing, fibo as OWL classes defined by axioms. This is the main finding.
- "classification of economic activities" in finto is the best candidate for FIBO's "industry sector classification scheme", because FIBO's own example lists NACE, NAICS and SIC.
- In finto, "commercial loan" is covered only by the more general "loans (amount of money)".
- finto's "lines of activity" hierarchy lists the sectors themselves. FIBO models the classifier that a scheme assigns to them, so the two are at different levels of abstraction.
- Several finto "loan" and "lending" terms are false friends: they relate to libraries, language or grain, not finance.

### Not established
- No equivalence was validated. The correspondences above are label- and hierarchy-based candidates only. They are not `exactMatch` or `equivalentClass` claims.
- I did not check whether finto has any links to FIBO or EDM Council IRIs. Only a 20-row sample of `exactMatch` was read.
- The finto searches used English labels and regexes, so concepts with only fi or sv labels, or worded differently, may have been missed. For example, I did not search for "yrityslainat" or "företagslån".
- The server reported `$lang: en` as "unresolved", so the language filter may not have been applied.
- Every search was capped (40, 60 or 150 rows), and the `narrower` list for "lines of activity" was cut off at 60 rows.
- I did not establish the identity of the unlabelled 4th FIBO class, or the class targeted by the `hasBorrower` restriction.
- I did not count concepts per finto scheme, so I cannot say how the 96,797 concepts are split between AFO, Allärs and Avoindata.
- Nothing here describes FIBO as a whole. The store holds a 2-module fragment, and its `owl:imports` (13) were not followed.
- Whether the Allärs or Avoindata.fi schemes in finto contain closer matches was not checked. All the matches I found were in AFO.