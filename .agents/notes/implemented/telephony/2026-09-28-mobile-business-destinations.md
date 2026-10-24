# Spanish and Italian mobile business destinations

## Evidence and decision

The user requested mobile destinations in both supported countries. Rejecting
all mobiles prevents calls to businesses using mobile numbers and controlled
tests on owned devices. Destination type and number-format errors must be
reported separately.

`isBusinessDestination` in contracts accepts ordinary Spanish mobile prefixes
6, 71–74 and 78, plus Italian 32–39 numbers with nine or ten national digits and
31/43 numbers with ten. Existing geographic landline patterns are retained while
excluding Italian 00 and 0878 televoting prefixes.
Mobile lengths and ranges were checked against Google's
[libphonenumber metadata](https://github.com/google/libphonenumber/blob/master/resources/PhoneNumberMetadata.xml).
The narrower Spanish callback policy is unchanged.

`businessDestinationError` supplies specific format, country, length and
unsupported-type messages to the shared call schema. The portal displays only
these known destination messages. Bypassing client validation does not bypass
the API or worker contract. Short codes and premium/service ranges are not
accepted; number ownership, reachability and consent are not inferred.

## Consequences and verification

Because `one_active_rate_card_per_country` permits one active rate card per
country and `connect_jobs.businessRate` pins that single country card, each
active ES and IT rate card must be sized to cover mobile termination before live
tests. Review outbound routing, authorized caller IDs, consent and disclosure
under [connect-me deployment](../../../../docs/operations.md#connect-me-deployment). No
provider configuration or funding restriction was changed, and no live call was
placed.

Contracts passed 81 tests; platform passed 215, with 37 disposable-database
integration tests skipped. Voice-worker tests passed 28. Contract and worker
typechecks passed. Changed platform files passed lint.
