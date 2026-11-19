# Comparing the concepts in james/finto and james/fibo

The two stores hold different kinds of thing, and that matters more than any shared word.

- **james/finto** is a large multilingual SKOS thesaurus collection. It holds 96,797 instances of `skos:Concept`, which are indexing concepts with labels in Finnish, Swedish and English. They are linked by `skos:broader`, `skos:narrower` and `skos:related`, plus mapping properties.
- **james/fibo** is a very small OWL export. It holds 4 `owl:Class`, 7 `owl:Restriction`, 1 `owl:DatatypeProperty` and 2 `owl:Ontology`. These are FIBO classes from two modules, each defined with axioms.

Only three labelled FIBO classes exist to compare. All three have plausible counterparts by label and topic in james/finto, inside the AFO vocabulary (`http://www.yso.fi/onto/afo/`). No formal mapping between the stores was observed, and I assert none.

## 1. What each store contains

**james/fibo** (`catalog scope=types`, `catalog scope=predicates`, selects on `owl:Class` and `owl:Ontology`):
- There are two ontologies:
  - "Classification Schemes Ontology", versionIRI `…/master/2026Q3/FND/Arrangements/ClassificationSchemes/`. Its abstract reads "abstract concepts for representation of industry classification schemes".
  - "Commercial Loans Ontology", versionIRI `…/master/2026Q3/LOAN/LoansSpecific/CommercialLoans/`.
- Between them they have 13 `owl:imports` (OMG Commons Classifiers, Designators, Organizations, RolesAndCompositions; FIBO Loans, Debt, Objectives, Arrangements, among others). The imported ontologies are not present in the store.
- There are three labelled classes, each with a `skos:definition`:

| Label (james/fibo) | Defined by | Superclass (named) | Restrictions on |
|---|---|---|---|
| industry sector classification scheme | FND/Arrangements/ClassificationSchemes/ | Commons `Classifiers/ClassificationScheme` | Designators `defines` / `isDefinedIn` (exact pairing to class not read) |
| industry sector classifier | same | Commons `Classifiers/Classifier` | same |
| commercial loan | LOAN/LoansSpecific/CommercialLoans/ | `LOAN/LoansGeneral/Loans/Loan` | `hasBusinessPurposeDescription`, `isPlayedBy`, `hasBorrower`, `hasObjective` |

- The fourth `owl:Class` has no label. It did not appear in the labelled selects, so I do not know what it is.
- The one datatype property is "has business purpose description". Its domain is `CommercialLoan` and it is a sub-property of Commons `hasDescription`.
- Further details:
  - The scheme class has a `skos:example` naming NAICS, SIC, NACE, GICS and ICB.
  - "commercial loan" carries the synonym "commercial and industrial loan".

Compiled SPARQL for the class select (node n4), as it ran:
```
SELECT ?RDFS_LABEL ?SKOS_DEFINITION ?RDFS_ISDEFINEDBY ?RDFS_SUBCLASSOF ?RDFS_LABEL ?SKOS_DEFINITION ?RDFS_ISDEFINEDBY ?RDFS_SUBCLASSOF
 FROM <urn:dydra:all> WHERE { { { { { { ?S <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://www.w3.org/2002/07/owl#Class> .
   ?S <http://www.w3.org/2000/01/rdf-schema#label> ?RDFS_LABEL .
   ?S <http://www.w3.org/2004/02/skos/core#definition> ?SKOS_DEFINITION .
   ?S <http://www.w3.org/2000/01/rdf-schema#isDefinedBy> ?RDFS_ISDEFINEDBY .
   ?S <http://www.w3.org/2000/01/rdf-schema#subClassOf> ?RDFS_SUBCLASSOF }
 OPTIONAL { ?S <http://www.w3.org/2000/01/rdf-schema#label> ?RDFS_LABEL } }}
 OPTIONAL { ?S <http://www.w3.org/2004/02/skos/core#definition> ?SKOS_DEFINITION } }}
 OPTIONAL { ?S <http://www.w3.org/2000/01/rdf-schema#isDefinedBy> ?RDFS_ISDEFINEDBY } }}
 OPTIONAL { ?S <http://www.w3.org/2000/01/rdf-schema#subClassOf> ?RDFS_SUBCLASSOF } }}}
 OFFSET 0 LIMIT 50
```
The `@optional` properties were also compiled as required patterns, so the "optional" declarations had no effect.

**james/finto** (`catalog scope=types`, `profile skos:Concept`, selects on `skos:ConceptScheme` and the skosmos Vocabulary type):

| Type | Count |
|---|---|
| `skos:Concept` | 96,797 |
| afo-meta:Concept | 11,980 |
| allars-meta:GeographicalConcept | 6,260 |
| `skos:Collection` | 475 |
| skos-thes:ThesaurusArray | 414 |
| skosext:DeprecatedConcept | 164 |
| void:Dataset | 39 |
| skosmos:Vocabulary | 39 |
| `skos:ConceptScheme` | 10 |
| `owl:Class` | 3 |
| `owl:DatatypeProperty` | 2 |
| `rdf:Property` | 2 |

- Predicate counts from the concept profile:

| Predicate | Count |
|---|---|
| `skos:prefLabel` | 369,601 |
| `skos:narrower` | 147,987 |
| `skos:broader` | 147,987 |
| `skos:related` | 152,440 |
| `skos:altLabel` | 75,445 |
| `skos:exactMatch` | 46,725 |
| `skos:closeMatch` | 26,620 |
| `skos:definition` | 52 |
| `owl:sameAs` | 8 |

- The skosmos Vocabulary titles describe a catalogue of Finnish vocabularies, including AFO, Allärs, YSO, YSA, LIITO (business ontology), JUHO, KOKO, MeSH, UDC Summary, Iconclass and IPTC.
- The three-letter vocabulary names are from the titles only. I did not establish how many of these vocabularies' concepts are actually loaded.
- Every concept I inspected reported `skos:inScheme <http://www.yso.fi/onto/afo/>`.

**The modelling difference.** In james/finto a subject is a concept used to index things. It is arranged by broader and narrower links and labelled in three languages, and carries almost no definitions (52 of 96,797). In james/fibo a subject is a class with a textual definition, named superclasses and property restrictions on its members, such as a borrower and a business purpose. The FIBO classes are about things in the world, like loans and classification schemes. The finto concepts are about topics for indexing. Any correspondence across the two is therefore a "topic about" relation, not class equivalence.

## 2. Candidate correspondences

The categories below (close, broader-topic, related) are my own judgements. They are not the SKOS predicates of the same name.

| james/fibo class | james/finto concept (AFO) | Category | Confidence | Reason |
|---|---|---|---|---|
| industry sector classification scheme | "classification of economic activities"@en / "toimialaluokitukset"@fi; broader "classifications" / "luokitukset (tieto)" | close | medium | FIBO's own example lists NACE/NAICS/SIC, which are classifications of economic activities. But finto's concept is an indexing topic, and the "scheme" sense is not separated from the "classifier" sense. |
| industry sector classification scheme | "classification schemes"@en (broader "classification systems") | broader-topic | medium | Same genus as the Commons ClassificationScheme superclass, but with no industry specificity. |
| industry sector classifier | "toimialat"@fi (lines of activity; broader "erikoisala"/"domain") | related | low | finto models industries or sectors themselves, not codes assigned to organisations. |
| commercial loan | "loans (amount of money)"@en / "lainat (rahasumma)"@fi / "lån (pengar)"@sv; broader "economic phenomena" | broader-topic | medium | Matches FIBO's superclass Loan in topic. No business-loan or commercial-loan concept was found in finto. |
| commercial loan | "credit extension"@en (broader "transfer of money") | related | low | Topical only. |
| (none) | "loans (loaned object)"@en | not a match | — | A loan of an object, such as a library loan. This is a different sense of "loan", and finto disambiguates it from the monetary sense. |

Searches in james/finto for business, corporate or commercial loans found nothing:
- English prefLabels: regex `business loans|corporate loans` returned nothing.
- Finnish prefLabels: `yrityslain` returned nothing.
- altLabels matching "loan" or "lainat" returned only general, home and arava (state-subsidised housing) loans.

The finto loans concept has the altLabels "lainat" and "aravalainat", which shows a Finnish housing-finance slant. FIBO's commercial loan is not reflected there.

Compiled SPARQL for the finto lookup (node n12), as it ran:
```
SELECT DISTINCT ?SKOS_PREFLABEL ?SKOS_INSCHEME ?SKOS_BROADER_SKOS_PREFLABEL
 FROM <urn:dydra:all> WHERE { { { ?S <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://www.w3.org/2004/02/skos/core#Concept> .
   ?S <http://www.w3.org/2004/02/skos/core#prefLabel> ?SKOS_PREFLABEL .
   ?S <http://www.w3.org/2004/02/skos/core#inScheme> ?SKOS_INSCHEME .
   ?S <http://www.w3.org/2004/02/skos/core#broader> ?SKOS_BROADER .
   ?SKOS_BROADER <http://www.w3.org/2004/02/skos/core#prefLabel> ?SKOS_BROADER_SKOS_PREFLABEL }
 FILTER ( regex(( str(?SKOS_PREFLABEL)), '^(classification of economic activities|loans \\(amount of money\\)|classification schemes|credit extension|business loans|corporate loans)$')) .
 FILTER ( langMatches(( lang(?SKOS_PREFLABEL)), 'en')) . }}
 OFFSET 0 LIMIT 60
```

## Observed

**james/fibo:**
- Types: 4 `owl:Class`, 7 `owl:Restriction`, 1 `owl:DatatypeProperty`, 2 `owl:Ontology`. There are 24 distinct predicates.
- 3 classes carry labels and definitions: industry sector classification scheme, industry sector classifier, commercial loan.
- Restrictions are on `isDefinedIn`, `defines` (×2), `hasBusinessPurposeDescription`, `isPlayedBy`, `hasBorrower` and `hasObjective`.
- 13 imports, all to ontologies not present in the store.
- No `skos:Concept` type appeared in its catalogue. SKOS appears only as annotation properties (`skos:definition`, `skos:example`, `skos:changeNote`).

**james/finto:**
- The type counts listed in section 1, including 96,797 `skos:Concept`.
- 113 Vocabulary title rows, covering 39 vocabularies in three languages.
- The ConceptScheme prefLabel select returned 9 rows, covering the vocabulary list and the Avoindata.fi ontologies.
- Concepts found in AFO:
  - "classification of economic activities" = "toimialaluokitukset", broader "classifications".
  - "classification schemes", broader "classification systems".
  - "loans (amount of money)", broader "economic phenomena", with altLabels "lainat" and "aravalainat".
  - "loans (loaned object)".
  - "credit extension".
  - "toimialat", with narrower concepts "luovat toimialat" and "kunnan toimialat".
- None of the targeted concepts I checked carry `skos:exactMatch`. That query returned 0 rows.
- No business, corporate or commercial loan label was found.

## Interpreted

- The stores differ in kind: an indexing thesaurus (finto) against axiomatised OWL classes (fibo). This is the main finding, and it limits every correspondence to topical relatedness.
- FIBO's three classes fall in two areas, industry classification and loans. finto covers both only at a general topic level, and its loan coverage leans towards public-sector and housing finance.
- "classification of economic activities" in finto is the strongest candidate for FIBO's industry sector classification scheme. I rest this on FIBO's own `skos:example`, which names NACE and its relatives.
- I infer that james/fibo is an extract of two FIBO modules, given the dangling imports and unlabelled superclass targets. It says nothing about FIBO as a whole.

## Not established

- **No equivalences were validated.** I do not claim any `owl:equivalentClass`, `skos:exactMatch` or `owl:sameAs` between the stores. The categories in section 2 are my own and rest on labels, broader context and FIBO definitions only.
- **Concept IRIs on the finto side were not retrieved.** The tool output omitted subject IRIs. A next run should add `@anchor` lookups or return `?S`, and should check whether these concepts also sit in YSO or LIITO, beyond the AFO scheme they reported.
- **Distribution of concepts across finto schemes was not counted.** The grouped query failed with a type error. I therefore do not know whether, for example, LIITO (the business ontology) is loaded; it would be the most relevant vocabulary here.
- **Narrower concepts of finto's "loans (amount of money)" were not read.** The last select (node n21) was issued but never narrowed or viewed. A commercial-loan-like concept could still exist under a label my regexes missed.
- **The fourth FIBO `owl:Class` is unidentified.** It has no label.
- **Restriction details were not read for any FIBO restriction.** The pairing of restrictions to classes was not resolved, and fillers and cardinalities (`owl:someValuesFrom`, `owl:onClass`, etc.) were not examined.
- **Coverage of finto's other concepts is unknown.** Search was by English or Finnish label regex over a few terms. Swedish labels, `skos:closeMatch` targets and the 46,725 `exactMatch` links were not examined, so absence of a match means "not found by these searches", not "absent".

— claude-opus-5-5 · james/finto 27, james/fibo 10 · 2026-11-10 · the exploration was stopped at the 26-round limit
recorded: james/finto → http://dydra.com/explorations/3DA4E204-DCFD-11F1-8369-F02F7494A8ED/transcript
recorded: james/fibo → http://dydra.com/explorations/49D58C54-DCFD-11F1-8471-F02F7494A8ED/transcript