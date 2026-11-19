# How the concepts in james/finto and james/fibo compare

## Summary

I compared the concepts in **james/finto** and **james/fibo**. They are different kinds of thing, and that matters more than any overlap in their labels.

- **james/finto** is a large SKOS indexing thesaurus. It holds 96,797 `skos:Concept` instances with labels in Finnish, Swedish and English. Its structure is `skos:broader`, `skos:narrower` and `skos:related` links, plus mappings to other vocabularies. It has almost no OWL: 3 `owl:Class` instances and 3 `rdfs:subClassOf` triples.
- **james/fibo** is a very small piece of the FIBO OWL ontology. It has 14 `rdf:type` triples in total. These cover two ontology headers (*Classification Schemes Ontology* and *Commercial Loans Ontology*), 3 labelled `owl:Class` instances plus 1 unlabelled one, 7 `owl:Restriction` instances and 1 `owl:DatatypeProperty`. It uses no SKOS concepts at all. It uses SKOS only for annotation (`skos:definition` ×4, `skos:changeNote` ×9, `skos:example` ×1).

The only overlap is in subject matter, around **loans** and **classification schemes**. james/finto has headings near both, but nothing narrow enough to be the same concept as FIBO's *commercial loan* or *industry sector classifier*. Every match below is my own judgement from reading labels, definitions and hierarchy. None of them is a validated equivalence.

## What each store contains

**james/finto** (`catalog {scope: types}` and `catalog {scope: predicates}`):

| Type | Count |
|---|---|
| skos:Concept | 96,797 |
| afo-meta:Concept | 11,980 |
| allars-meta:GeographicalConcept | 6,260 |
| skos:Collection | 475 |
| iso25964 ThesaurusArray | 414 |
| skosext:DeprecatedConcept | 164 |
| void:Dataset | 39 |
| skosmos:Vocabulary | 39 |
| skos:ConceptScheme | 10 |
| owl:Class | 3 |
| owl:DatatypeProperty | 2 |
| rdf:Property | 2 |

The main predicates and their counts in james/finto are:
- `skos:prefLabel` 202,085
- `skos:related` 91,292
- `skos:broader` and `skos:narrower` 84,629 each
- `skos:altLabel` 41,985
- `skos:exactMatch` 39,803
- `skos:closeMatch` 26,620
- `skos:narrowMatch` 2,000
- `skos:broadMatch` 489

Running `select {@type: skos:Concept, @shape:[skos:inScheme], @distinct:true}` found 7 schemes that concepts belong to:
- `http://www.yso.fi/onto/afo/`
- `http://www.yso.fi/onto/afo/aggregateconceptscheme`
- `http://www.yso.fi/onto/afo/deprecatedconceptscheme`
- `http://www.yso.fi/onto/allars/`
- `http://avoindata.fi/onto/topic`
- `http://avoindata.fi/onto/contentType`
- `http://dydra.com/#categories`

Scheme titles include *AFO – Natural resource and environment ontology*, *General thesaurus in Swedish – Allärs* and *Ontology of Avoindata.fi: Topic / Content type*. The type catalogue counts 10 `skos:ConceptScheme`, but only 7 distinct schemes have concepts in them.

**james/fibo** (`catalog {scope: predicates}`; the types catalogue returned HTTP 502 twice, so I listed the `rdf:type` values with `select`):

The two ontologies are:
- **Classification Schemes Ontology.** Version IRI `…/master/2026Q3/FND/Arrangements/ClassificationSchemes/`. Abstract: "abstract concepts for representation of industry classification schemes".
- **Commercial Loans Ontology.** Version IRI `…/LOAN/LoansSpecific/CommercialLoans/`.

Between them they have 13 `owl:imports` triples, pointing to FIBO FND, FBC and LOAN modules and to OMG Commons modules (Classifiers, Designators, Organizations, RolesAndCompositions and others). **None of the imported content is in the store.**

The labelled classes are:

| Label | Named superclass (other parents are restrictions) | Definition (abridged) |
|---|---|---|
| industry sector classification scheme | `omg Commons/Classifiers/ClassificationScheme` | "system for allocating classifiers to organizations by industry sector" |
| industry sector classifier | `omg Commons/Classifiers/Classifier` | "standardized classification or delineation for an organization… by industry" |
| commercial loan | `fibo LOAN/LoansGeneral/Loans/Loan` | "loan extended to a corporation, commercial enterprise, joint venture, or other organization as opposed to a consumer" |

There is also one unlabelled `owl:Class`. One of its `rdfs:subClassOf` values is `fibo FND/Arrangements/Arrangements/Scheme`.

The 7 restrictions, by the property they constrain:
- `Designators/isDefinedIn`: exactly 1 (`qualifiedCardinality` 1) of class `IndustrySectorClassificationScheme`.
- `Designators/defines`: `someValuesFrom IndustrySectorClassifier`.
- `Designators/defines`: `allValuesFrom Classifier`.
- `CommercialLoans/hasBusinessPurposeDescription`: at least 0, data range `xsd:string`.
- `RolesAndCompositions/isPlayedBy`: `someValuesFrom LegalEntity`.
- `Debt/hasBorrower`: `someValuesFrom` a blank node.
- `Objectives/hasObjective`: at least 0 of class `BusinessObjective`.

## The difference in kind

A james/finto term is a **heading for indexing documents**. Its meaning comes from its labels in three languages, where it sits under broader headings, and its mappings. Some headings split a meaning in two: "loans (amount of money)" and "loans (loaned object)" are separate headings.

A james/fibo term is an **OWL class with logical constraints**. For example, *commercial loan* is a subclass of `Loan` whose instances must have a borrower and may carry a business purpose and objectives. A concept and a class are not the same sort of object. Even a perfect label match would at most justify a "heading X can be used to index things that are instances of class Y" relationship, not class equivalence.

## Candidate correspondences

The categories *close*, *broader* and *related* below are my own words, not the SKOS predicates of the same name. All the james/finto headings below report `skos:inScheme <http://www.yso.fi/onto/afo/>`.

| james/fibo class | james/finto heading (broader heading in james/finto) | My category | Confidence | Reason |
|---|---|---|---|---|
| commercial loan | "loans (amount of money)" (under "economic phenomena") | broader | medium | The james/finto heading is general money lending; the FIBO class narrows it to commercial purpose or organisational borrowers. Neither a regex for loan/lending/borrow in English nor a Swedish search for business-loan terms found a commercial or business loan heading. |
| commercial loan | "capital loans" (under "loans (amount of money)") | related | low | It sits under the same parent, but the label does not say the borrower is an organisation. |
| industry sector classification scheme | "classification of economic activities" (under "classifications") | close | medium-low | Both name a scheme for classifying economic activity or industry. The james/finto heading has no scope note to confirm what it means. |
| industry sector classification scheme | "classification schemes" (under "classification systems") | broader | medium | This is a generic heading for classification schemes; FIBO's class is a specialisation of the classification-scheme idea. |
| industry sector classifier | none | none | — | I found no heading for an individual class code or sector designation. |

The following james/finto headings match only on the string and are **not** candidates: "lending" (it sits under library services), "art lending libraries", "interlibrary lending", "loanwords" and "loan translations".

## Operations, for re-running

- **james/fibo**: I ran `select {@type: owl:Class, @shape: [], @optional: [rdfs:label, skos:definition, rdfs:subClassOf, rdfs:isDefinedBy], @limit: 50}`. It compiled to:
  ```
  SELECT ?RDFS_LABEL ?SKOS_DEFINITION ?RDFS_SUBCLASSOF ?RDFS_ISDEFINEDBY
   FROM <urn:dydra:all> WHERE { { { { { { ?S <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://www.w3.org/2002/07/owl#Class> }
   OPTIONAL { ?S <http://www.w3.org/2000/01/rdf-schema#label> ?RDFS_LABEL } }}
   OPTIONAL { ?S <http://www.w3.org/2004/02/skos/core#definition> ?SKOS_DEFINITION } }}
   OPTIONAL { ?S <http://www.w3.org/2000/01/rdf-schema#subClassOf> ?RDFS_SUBCLASSOF } }}
   OPTIONAL { ?S <http://www.w3.org/2000/01/rdf-schema#isDefinedBy> ?RDFS_ISDEFINEDBY } }}}
   OFFSET 0 LIMIT 50
  ```
  I also ran `select {@type: owl:Restriction, …}` and `select {@type: owl:Ontology, …}`.
- **james/finto**: I ran `select {@type: skos:Concept, @shape:[skos:prefLabel, skos:inScheme, {skos:broader:[skos:prefLabel]}], @distinct:true, @limit:100}`, then `narrow` with a regex. That compiled to:
  ```
  SELECT DISTINCT ?SKOS_PREFLABEL ?SKOS_INSCHEME ?SKOS_BROADER_SKOS_PREFLABEL
   FROM <urn:dydra:all> WHERE { { { ?S <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://www.w3.org/2004/02/skos/core#Concept> .
   ?S <http://www.w3.org/2004/02/skos/core#prefLabel> ?SKOS_PREFLABEL .
   ?S <http://www.w3.org/2004/02/skos/core#inScheme> ?SKOS_INSCHEME .
   ?S <http://www.w3.org/2004/02/skos/core#broader> ?SKOS_BROADER .
   ?SKOS_BROADER <http://www.w3.org/2004/02/skos/core#prefLabel> ?SKOS_BROADER_SKOS_PREFLABEL }
   FILTER ( regex(( str(?SKOS_PREFLABEL)), '^(loans \\(amount of money\\)|lending|classification schemes|classification of economic activities|capital loans|borrowed capital)$')) .
   FILTER ( langMatches(( lang(?SKOS_PREFLABEL)), 'en')) . }}
   OFFSET 0 LIMIT 100
  ```
  The searches I used were: on the distinct prefLabel node, `narrow` with regex `loan|lending|borrow` and `classif|industrial sector|sectors|branches of` (both English), and `företagslån|kommersiell|lån$|^lån` (Swedish).

## Observed

- **james/finto:** 63 predicates and 12 types. There are 96,797 `skos:Concept`, 10 `skos:ConceptScheme` and 3 `owl:Class`, with `skos:prefLabel` ×202,085 and `skos:exactMatch` ×39,803. Concepts belong to 7 distinct schemes (listed above).
- **james/finto:** the English loan/lending/borrow search returned 18 headings. None mentions commercial, business or corporate loans.
- **james/finto:** "loans (amount of money)" has broader heading "economic phenomena". "capital loans" sits under it. "classification of economic activities" sits under "classifications". "classification schemes" sits under "classification systems". "lending" sits under "library services".
- **james/finto:** "loans (amount of money)", "classification schemes" and "classification of economic activities" have no `skos:exactMatch`, `skos:closeMatch` or `skos:scopeNote` values.
- **james/finto:** the Swedish search found "lån (pengar)", "lån", "kapitallån", "bostadslån" and others, but no business-loan term.
- **james/finto:** without `@distinct`, each concept came back as 8 identical rows.
- **james/fibo:** 24 predicates and 14 `rdf:type` triples, made up of 2 `owl:Ontology`, 4 `owl:Class` (3 labelled), 7 `owl:Restriction` and 1 `owl:DatatypeProperty` ("has business purpose description").
- **james/fibo:** the class definitions, superclasses, restrictions and 13 imports are as shown in the tables above.
- **Both stores:** `catalog {scope: types}` returned HTTP 502. On a retry it worked for james/finto but failed again for james/fibo.

## Interpreted

- james/finto is a multilingual SKOS thesaurus service whose content is mostly AFO and Allärs. james/fibo is a two-module extract of FIBO with no imported context. The comparison is therefore between thesaurus headings and OWL classes, not between like and like.
- I read the subject overlap as narrow: loans and classification schemes. james/finto is general-purpose and broader in level. FIBO's classes are finance-specific specialisations with axioms that james/finto has no way to express.
- The best matches are james/finto headings that are *broader than* or *close to* the FIBO classes. I judged this from definitions and hierarchy position, not from label equality.
- I take the 8× repeated rows in james/finto to mean the same triples appear in several graphs under the `<urn:dydra:all>` dataset. The counts from `catalog` may include that duplication.

## Not established

- **No equivalence is asserted or validated.** None of the matches above is an `owl:equivalentClass`, `skos:exactMatch` or `owl:sameAs`, and none was checked against an external mapping.
- **No IRIs for the james/finto headings.** The select output did not return subject IRIs, so I identified headings by label and scheme only.
- **Some james/fibo class IRIs are inferred.** I saw the IRIs for `IndustrySectorClassificationScheme` and `IndustrySectorClassifier` only as restriction targets. I never saw *commercial loan*'s own IRI. The unlabelled class is unidentified.
- **Search coverage was partial.** I searched by English regex and a little Swedish. Finnish labels, `skos:altLabel` and `skos:hiddenLabel` were not searched, so a commercial-loan heading could exist under one of those.
- **Not all of james/finto was checked for loan or classification headings.** The deprecated, aggregate and avoindata schemes and the `dydra #categories` scheme were not looked at separately, nor were the 3 `owl:Class` instances in james/finto.
- **Nothing is known about the rest of FIBO.** Loan types, borrower classes, the imported Commons classifier classes and FIBO's industry classifier instances are not in james/fibo, so this says nothing about how FIBO as a whole would align with james/finto.
- **Some james/finto counts may be inflated** by the duplication across graphs.
- **The james/fibo type catalogue never ran.** Its inventory comes from listing `rdf:type` values directly.

— claude-opus-5-5 · james/finto 25, james/fibo 9 · 2026-11-10
recorded: james/finto → http://dydra.com/explorations/AEBF2962-DCA4-11F1-B393-F02F7494A8ED/transcript
recorded: james/fibo → http://dydra.com/explorations/BB03EABE-DCA4-11F1-AE60-F02F7494A8ED/transcript