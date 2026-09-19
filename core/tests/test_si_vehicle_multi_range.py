from bluewolf_runtime_adapter.si_template_config import (
    parse_si_vehicle_types,
    resolve_si_vehicle_type,
)


def test_multi_range_vehicle_profile_resolves_each_configured_interval():
    profiles = parse_si_vehicle_types([
        {
            "id": "storm",
            "minId": 10,
            "maxId": 19,
            "ranges": [
                {"minId": 10, "maxId": 19},
                {"minId": 40, "maxId": 49},
            ],
            "workSpeedMps": 12.5,
            "siRoles": ["outer"],
        },
        {
            "id": "lightning",
            "minId": 100,
            "maxId": 109,
            "workSpeedMps": 15.0,
            "siRoles": ["middle"],
        },
    ])
    assert resolve_si_vehicle_type(profiles, 12).type_id == "storm"
    assert resolve_si_vehicle_type(profiles, 45).type_id == "storm"
    assert resolve_si_vehicle_type(profiles, 105).type_id == "lightning"
    assert resolve_si_vehicle_type(profiles, 25) is None


def test_multi_range_vehicle_profiles_reject_cross_range_overlap():
    try:
        parse_si_vehicle_types([
            {
                "id": "storm",
                "minId": 10,
                "maxId": 19,
                "ranges": [{"minId": 10, "maxId": 19}, {"minId": 40, "maxId": 49}],
                "workSpeedMps": 12.5,
                "siRoles": ["outer"],
            },
            {
                "id": "lightning",
                "minId": 45,
                "maxId": 55,
                "ranges": [{"minId": 45, "maxId": 55}],
                "workSpeedMps": 15.0,
                "siRoles": ["middle"],
            },
        ])
    except ValueError as exc:
        assert "overlapping SI vehicle id ranges" in str(exc)
    else:
        raise AssertionError("overlapping multi-range profiles must fail closed")
