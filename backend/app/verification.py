"""
How far a place or lane can be trusted (docs/NASHIK_GEO_DATA_PIPELINE.md).
Nothing is promoted automatically: imported data stays `osm_imported` until a
person reviews it, a volunteer confirms it on site, or an official source does.
"""
OSM_IMPORTED = "osm_imported"  # from OpenStreetMap, nobody checked it
UNVERIFIED = "unverified"  # entered without evidence (e.g. a straight link nobody walked)
REMOTELY_REVIEWED = "remotely_reviewed"  # checked by a person on maps / imagery, not on site
VOLUNTEER_VERIFIED = "volunteer_verified"  # a volunteer stood there / walked it with GPS
OFFICIALLY_VERIFIED = "officially_verified"  # confirmed by the Mela authority or another official source
REJECTED = "rejected"  # wrong or unsafe: kept for the record, never routed or listed

STATUSES = (
    OSM_IMPORTED,
    UNVERIFIED,
    REMOTELY_REVIEWED,
    VOLUNTEER_VERIFIED,
    OFFICIALLY_VERIFIED,
    REJECTED,
)
# Checked on the ground: routes along these are drawn solid, others dashed.
FIELD_VERIFIED = {VOLUNTEER_VERIFIED, OFFICIALLY_VERIFIED}
# Set by people: an OSM re-import never changes these back.
REVIEWED = {REMOTELY_REVIEWED, VOLUNTEER_VERIFIED, OFFICIALLY_VERIFIED, REJECTED}
