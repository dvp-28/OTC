import requests
import io
import zipfile
import urllib3
import sys

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

BASE_URL = "https://localhost"

def make_dummy_pptx():
    bio = io.BytesIO()
    with zipfile.ZipFile(bio, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>')
        z.writestr('ppt/presentation.xml', '<?xml version="1.0" encoding="UTF-8"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"></p:presentation>')
    bio.seek(0)
    return bio.getvalue()

def make_dummy_ppt():
    header = b"\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1"
    padding = b"\x00" * 512
    return header + padding

def make_dummy_mp4():
    return b"\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00isommp42" + (b"\x00" * 4096)

def make_dummy_mp3():
    return b"ID3\x03\x00\x00\x00\x00\x00\x00" + (b"\xff\xfb\x90\x00" * 256)

def login(username, password):
    s = requests.Session()
    s.verify = False
    res = s.post(f"{BASE_URL}/api/login", json={"username": username, "password": password})
    assert res.status_code == 200, f"Login failed for {username}: {res.text}"
    data = res.json()
    assert data["status"] == "success", f"Login response error: {data}"
    return s, data["data"]

def run_tests():
    print("=== STARTING COURSE PPTS SUITE AUDIT ===")

    # 1. Student Officer Tests
    print("\n--- 1. Testing Student Officer (student.officer) ---")
    s_stud, stud_user = login("student.officer", "Student@2026!")
    print(f"[OK] Authenticated student: {stud_user['username']} (Role: {stud_user['role']})")

    # Student can view enrolled course (MOBC = id 2)
    res = s_stud.get(f"{BASE_URL}/api/course-ppts?course_id=2")
    assert res.status_code == 200, f"Student failed to view MOBC: {res.status_code} {res.text}"
    mobc_ppts = res.json()["data"]
    print(f"[OK] Student can view enrolled course (MOBC) PPTs: {len(mobc_ppts)} found")
    assert len(mobc_ppts) > 0, "Expected at least 1 presentation in MOBC"
    assert "slide_count" in mobc_ppts[0], "Missing slide_count in presentation data"
    assert mobc_ppts[0]["slide_count"] >= 1, "Expected slide_count >= 1"
    assert "timecreated_formatted" in mobc_ppts[0], "Missing timecreated_formatted in presentation data"
    print(f"[OK] Presentation attributes verified: Slide Count = {mobc_ppts[0]['slide_count']}, Upload Date-Time = '{mobc_ppts[0]['timecreated_formatted']}'")

    # Student CANNOT view unassigned course (MOJCC = id 3)
    res = s_stud.get(f"{BASE_URL}/api/course-ppts?course_id=3")
    assert res.status_code == 403, f"Student should be blocked from unassigned course MOJCC, got: {res.status_code}"
    print("[OK] [Security Guard] Student blocked from viewing unassigned course MOJCC (HTTP 403)")

    # Student CANNOT upload PPT to any course
    dummy_pptx = make_dummy_pptx()
    files = {"file": ("Tactical_TCCC.pptx", dummy_pptx, "application/vnd.openxmlformats-officedocument.presentationml.presentation")}
    data = {"course_id": "2", "title": "Tactical TCCC"}
    res = s_stud.post(f"{BASE_URL}/api/course-ppts/upload", data=data, files=files)
    assert res.status_code == 403, f"Student upload should be 403 Forbidden, got: {res.status_code}"
    print("[OK] [Security Guard] Student blocked from uploading presentations (HTTP 403)")

    # 2. Course Admin Tests
    print("\n--- 2. Testing Course Admin (course.admin) ---")
    s_cadmin, cadmin_user = login("course.admin", "CourseAdmin@2026!")
    print(f"[OK] Authenticated course admin: {cadmin_user['username']} (Role: {cadmin_user['role']})")
    print(f"     Assigned courses: {cadmin_user['assigned_courses']}")

    # Course Admin CANNOT upload to unassigned course (e.g. MOJCC = id 3)
    files = {"file": ("MOJCC_Deck.pptx", dummy_pptx, "application/vnd.openxmlformats-officedocument.presentationml.presentation")}
    data = {"course_id": "3", "title": "MOJCC Unassigned Deck"}
    res = s_cadmin.post(f"{BASE_URL}/api/course-ppts/upload", data=data, files=files)
    assert res.status_code == 403, f"Course Admin upload to unassigned course should be 403, got: {res.status_code}"
    print("[OK] [Security Guard] Course Admin blocked from uploading to unassigned course (HTTP 403)")

    # Course Admin CAN upload to assigned course (MOBC = id 2)
    files = {"file": ("MOBC_Battlefield_Trauma.pptx", dummy_pptx, "application/vnd.openxmlformats-officedocument.presentationml.presentation")}
    data = {"course_id": "2", "title": "Battlefield Trauma Management"}
    res = s_cadmin.post(f"{BASE_URL}/api/course-ppts/upload", data=data, files=files)
    assert res.status_code == 200, f"Course Admin upload to MOBC failed: {res.status_code} {res.text}"
    mobc_ppt_data = res.json()["data"]
    mobc_ppt_id = mobc_ppt_data["id"]
    print(f"[OK] Course Admin uploaded presentation to assigned course MOBC (PPT ID: {mobc_ppt_id})")

    # 3. Institute Admin Tests
    print("\n--- 3. Testing Institute Admin (inst.admin) ---")
    s_iadmin, iadmin_user = login("inst.admin", "InstAdmin@2026!")
    print(f"[OK] Authenticated Institute Admin: {iadmin_user['username']} (Role: {iadmin_user['role']})")

    # Institute Admin can upload to any course (e.g. MOJCC = id 3)
    dummy_ppt = make_dummy_ppt()
    files = {"file": ("Staff_Duties_Command.ppt", dummy_ppt, "application/vnd.ms-powerpoint")}
    data = {"course_id": "3", "title": "Staff Duties in Corps Zones"}
    res = s_iadmin.post(f"{BASE_URL}/api/course-ppts/upload", data=data, files=files)
    assert res.status_code == 200, f"Institute Admin upload to MOJCC failed: {res.status_code} {res.text}"
    mojcc_ppt_data = res.json()["data"]
    mojcc_ppt_id = mojcc_ppt_data["id"]
    print(f"[OK] Institute Admin uploaded PPT to MOJCC (PPT ID: {mojcc_ppt_id})")

    # 4. Strict Course-Specific Isolation
    print("\n--- 4. Testing Course-Specific Presentation Isolation ---")
    res_mobc = s_iadmin.get(f"{BASE_URL}/api/course-ppts?course_id=2").json()["data"]
    res_mojcc = s_iadmin.get(f"{BASE_URL}/api/course-ppts?course_id=3").json()["data"]
    mobc_ids = [p["id"] for p in res_mobc]
    mojcc_ids = [p["id"] for p in res_mojcc]

    assert mobc_ppt_id in mobc_ids, "MOBC presentation not found in MOBC list"
    assert mojcc_ppt_id not in mobc_ids, "Cross-contamination: MOJCC presentation leaked into MOBC!"
    assert mojcc_ppt_id in mojcc_ids, "MOJCC presentation not found in MOJCC list"
    assert mobc_ppt_id not in mojcc_ids, "Cross-contamination: MOBC presentation leaked into MOJCC!"
    print(f"[OK] Perfect course isolation verified! MOBC has {len(mobc_ids)} presentations, MOJCC has {len(mojcc_ids)} presentations.")

    # 5. File Download & Content Verification
    print("\n--- 5. Testing Presentation Downloads ---")
    # Student downloads MOBC presentation
    dl_res = s_stud.get(f"{BASE_URL}/api/course-ppts/{mobc_ppt_id}/download")
    assert dl_res.status_code == 200, f"Student download failed: {dl_res.status_code}"
    assert dl_res.content == dummy_pptx, "Downloaded PPTX content does not match uploaded file!"
    assert "attachment" in dl_res.headers.get("Content-Disposition", ""), "Missing attachment Content-Disposition header"
    print(f"[OK] Student successfully downloaded MOBC presentation (Bytes: {len(dl_res.content)}, Content Verified)")

    # Student tries to download MOJCC presentation (unassigned) -> HTTP 403
    dl_unauth = s_stud.get(f"{BASE_URL}/api/course-ppts/{mojcc_ppt_id}/download")
    assert dl_unauth.status_code == 403, f"Unauthorized download should be 403, got: {dl_unauth.status_code}"
    print("[OK] [Security Guard] Student blocked from downloading unassigned course presentation (HTTP 403)")

    # 6. Malformed & Malicious Upload Defense
    print("\n--- 6. Testing Malicious / Invalid Upload Protections ---")
    # A. Fake extension (.php)
    php_code = b"<?php echo 'malicious'; ?>"
    res_php = s_iadmin.post(f"{BASE_URL}/api/course-ppts/upload", data={"course_id": "2", "title": "Exploit"}, files={"file": ("shell.php", php_code, "application/x-php")})
    assert res_php.status_code == 400, f"PHP upload should be 400, got: {res_php.status_code}"
    print("[OK] [Security Guard] Executable .php upload rejected (HTTP 400)")

    # B. Fake content (text file with .pptx extension)
    fake_txt = b"This is not a real presentation"
    res_fake = s_iadmin.post(f"{BASE_URL}/api/course-ppts/upload", data={"course_id": "2", "title": "Fake Deck"}, files={"file": ("fake.pptx", fake_txt, "application/vnd.openxmlformats-officedocument.presentationml.presentation")})
    assert res_fake.status_code == 400, f"Fake PPTX should be 400, got: {res_fake.status_code}"
    print("[OK] [Security Guard] Fake PPTX magic-byte spoofing rejected (HTTP 400)")

    # 7. Cascade Deletion on Course Delete
    print("\n--- 7. Testing Cascade Deletion on Course Deletion ---")
    # Create test course
    c_res = s_iadmin.post(f"{BASE_URL}/api/courses/create", json={"fullname": "Test Cascade Course 2026", "shortname": "TCC-2026", "category_id": 1, "summary": "Test cascade"})
    assert c_res.status_code == 200, f"Failed to create test course: {c_res.text}"
    test_cid = c_res.json()["data"]["id"]
    print(f"[OK] Created temporary course for cascade testing (ID: {test_cid})")

    # Upload PPT to test course
    res_up = s_iadmin.post(f"{BASE_URL}/api/course-ppts/upload", data={"course_id": str(test_cid), "title": "Cascade Slide Deck"}, files={"file": ("Cascade_Deck.pptx", dummy_pptx, "application/vnd.openxmlformats-officedocument.presentationml.presentation")})
    assert res_up.status_code == 200, f"Failed to upload PPT to test course: {res_up.text}"
    cascade_ppt_id = res_up.json()["data"]["id"]
    print(f"[OK] Uploaded presentation to test course (PPT ID: {cascade_ppt_id})")

    # Delete test course
    del_res = s_iadmin.post(f"{BASE_URL}/api/courses/delete", json={"course_id": test_cid})
    assert del_res.status_code == 200, f"Failed to delete course: {del_res.text}"
    print(f"[OK] Successfully deleted course {test_cid}")

    # Verify PPT is purged from database
    chk_res = s_iadmin.get(f"{BASE_URL}/api/course-ppts/{cascade_ppt_id}/download")
    assert chk_res.status_code == 404, f"Deleted course PPT should be 404, got: {chk_res.status_code}"
    print("[OK] Cascade deletion verified: presentation metadata and storage cleanly purged")

    # 8. Direct PPT Deletion Tests (RBAC & Storage cleanup)
    print("\n--- 8. Testing Direct PPT Deletion with RBAC & Storage Cleanup ---")
    # Upload a test PPT to MOBC for deletion tests
    up_del_test = s_cadmin.post(f"{BASE_URL}/api/course-ppts/upload", data={"course_id": "2", "title": "Delete Me Test Deck"}, files={"file": ("Delete_Me.pptx", dummy_pptx, "application/vnd.openxmlformats-officedocument.presentationml.presentation")})
    assert up_del_test.status_code in [200, 201], f"Failed to upload test PPT: {up_del_test.text}"
    del_target_id = up_del_test.json()["data"]["id"]
    print(f"[OK] Uploaded test PPT for deletion testing (ID: {del_target_id})")

    # 8a. Student CANNOT delete PPT (HTTP 403)
    del_stud_res = s_stud.post(f"{BASE_URL}/api/course-ppts/{del_target_id}/delete")
    assert del_stud_res.status_code == 403, f"Student should be 403, got: {del_stud_res.status_code}"
    print("[OK] [Security Guard] Student blocked from deleting presentation (HTTP 403)")

    # 8b. Course Admin CANNOT delete PPT from unassigned course (MOJCC = id 3)
    # First get a PPT from MOJCC
    mojcc_ppts_list = s_iadmin.get(f"{BASE_URL}/api/course-ppts?course_id=3").json()["data"]
    if mojcc_ppts_list:
        mojcc_sample_id = mojcc_ppts_list[0]["id"]
        del_unassigned_res = s_cadmin.post(f"{BASE_URL}/api/course-ppts/{mojcc_sample_id}/delete")
        assert del_unassigned_res.status_code == 403, f"Course Admin should be 403 on unassigned course, got: {del_unassigned_res.status_code}"
        print("[OK] [Security Guard] Course Admin blocked from deleting presentation in unassigned course (HTTP 403)")

    # 8c. Course Admin CAN delete PPT in assigned course (MOBC)
    del_cadmin_res = s_cadmin.post(f"{BASE_URL}/api/course-ppts/{del_target_id}/delete")
    assert del_cadmin_res.status_code == 200, f"Course Admin failed to delete PPT: {del_cadmin_res.text}"
    print(f"[OK] Course Admin deleted presentation in assigned course (PPT ID: {del_target_id})")

    # Verify deleted PPT is no longer downloadable (HTTP 404)
    chk_deleted = s_cadmin.get(f"{BASE_URL}/api/course-ppts/{del_target_id}/download")
    assert chk_deleted.status_code == 404, f"Deleted PPT should be 404, got: {chk_deleted.status_code}"
    print("[OK] Verified deleted presentation is gone from database & storage (HTTP 404)")

    # 8d. Institute Admin CAN delete any PPT
    up_inst_del = s_iadmin.post(f"{BASE_URL}/api/course-ppts/upload", data={"course_id": "3", "title": "Inst Admin Delete Test"}, files={"file": ("Inst_Del.pptx", dummy_pptx, "application/vnd.openxmlformats-officedocument.presentationml.presentation")})
    assert up_inst_del.status_code in [200, 201], f"Inst upload failed: {up_inst_del.text}"
    inst_del_id = up_inst_del.json()["data"]["id"]
    del_inst_res = s_iadmin.post(f"{BASE_URL}/api/course-ppts/{inst_del_id}/delete")
    assert del_inst_res.status_code == 200, f"Inst Admin failed to delete PPT: {del_inst_res.text}"
    print(f"[OK] Institute Admin deleted presentation in course 3 (PPT ID: {inst_del_id})")

    # 9. Video & Audio Upload and HTTP Range Streaming
    print("\n--- 9. Testing Video & Audio Lecture Uploads and Media Streaming ---")
    dummy_mp4 = make_dummy_mp4()
    dummy_mp3 = make_dummy_mp3()

    # 9a. Course Admin uploads MOBC presentation with accompanying MP4 video
    up_media_res = s_cadmin.post(
        f"{BASE_URL}/api/course-ppts/upload",
        data={"course_id": "2", "title": "Tactical Field Evacuation with Video Lecture"},
        files={
            "file": ("Field_Evacuation.pptx", dummy_pptx, "application/vnd.openxmlformats-officedocument.presentationml.presentation"),
            "media_file": ("lecture_field_evac.mp4", dummy_mp4, "video/mp4")
        }
    )
    assert up_media_res.status_code in [200, 201], f"Media upload failed: {up_media_res.text}"
    media_ppt = up_media_res.json()["data"]
    media_ppt_id = media_ppt["id"]
    print(f"[OK] Uploaded presentation with attached video (ID: {media_ppt_id}, Media Type: {media_ppt.get('media_type')})")
    assert media_ppt["has_media"] is True, "Expected has_media to be True"
    assert media_ppt["media_type"] == "video", f"Expected media_type == 'video', got {media_ppt.get('media_type')}"
    assert "stream" in media_ppt["media_stream_url"], "Invalid stream URL"

    # 9b. Student (enrolled in MOBC) streams video
    stream_res = s_stud.get(f"{BASE_URL}/api/course-ppts/{media_ppt_id}/stream")
    assert stream_res.status_code == 200, f"Streaming failed: {stream_res.status_code}"
    assert "video/mp4" in stream_res.headers.get("Content-Type", ""), f"Wrong content-type: {stream_res.headers.get('Content-Type')}"
    assert stream_res.headers.get("Accept-Ranges") == "bytes", "Missing Accept-Ranges: bytes"
    assert len(stream_res.content) == len(dummy_mp4), "Full stream length mismatch"
    print(f"[OK] Student streamed entire video presentation (HTTP 200, {len(stream_res.content)} bytes)")

    # 9c. Student requests partial byte range (HTTP 206 Partial Content)
    range_res = s_stud.get(f"{BASE_URL}/api/course-ppts/{media_ppt_id}/stream", headers={"Range": "bytes=0-99"})
    assert range_res.status_code == 206, f"Range request should be 206 Partial Content, got: {range_res.status_code}"
    assert len(range_res.content) == 100, f"Expected 100 bytes for range 0-99, got: {len(range_res.content)}"
    assert range_res.headers.get("Content-Range", "").startswith("bytes 0-99/"), f"Wrong Content-Range: {range_res.headers.get('Content-Range')}"
    print("[OK] Video HTTP Range requests verified (HTTP 206 Partial Content, smooth seeking)")

    # 9d. Student CANNOT stream media from unassigned course (e.g. MOJCC = id 3)
    mojcc_up_video = s_iadmin.post(
        f"{BASE_URL}/api/course-ppts/upload",
        data={"course_id": "3", "title": "MOJCC Classified Video"},
        files={"media_file": ("mojcc_lecture.mp4", dummy_mp4, "video/mp4")}
    )
    mojcc_video_id = mojcc_up_video.json()["data"]["id"]
    stud_stream_blocked = s_stud.get(f"{BASE_URL}/api/course-ppts/{mojcc_video_id}/stream")
    assert stud_stream_blocked.status_code == 403, f"Student stream of unassigned course should be 403, got: {stud_stream_blocked.status_code}"
    print("[OK] [Security Guard] Student blocked from streaming unassigned course media (HTTP 403)")

    # 9e. Audio file upload and streaming
    up_audio_res = s_cadmin.post(
        f"{BASE_URL}/api/course-ppts/upload",
        data={"course_id": "2", "title": "Tactical Casualty Care Audio Brief"},
        files={"media_file": ("briefing.mp3", dummy_mp3, "audio/mpeg")}
    )
    assert up_audio_res.status_code in [200, 201], f"Audio upload failed: {up_audio_res.text}"
    audio_ppt = up_audio_res.json()["data"]
    audio_ppt_id = audio_ppt["id"]
    assert audio_ppt["media_type"] == "audio", f"Expected media_type == 'audio', got {audio_ppt.get('media_type')}"
    print(f"[OK] Uploaded audio lecture (ID: {audio_ppt_id}, Type: audio)")

    audio_stream_res = s_stud.get(f"{BASE_URL}/api/course-ppts/{audio_ppt_id}/stream")
    assert audio_stream_res.status_code == 200, f"Audio streaming failed: {audio_stream_res.status_code}"
    assert "audio/mpeg" in audio_stream_res.headers.get("Content-Type", "")
    print(f"[OK] Student streamed audio briefing ({len(audio_stream_res.content)} bytes, Content-Type: audio/mpeg)")

    # 9f. Deleting presentation cleans up attached media file from disk
    del_media_ppt = s_cadmin.post(f"{BASE_URL}/api/course-ppts/{media_ppt_id}/delete")
    assert del_media_ppt.status_code == 200, f"Failed to delete media presentation: {del_media_ppt.text}"
    stream_after_del = s_cadmin.get(f"{BASE_URL}/api/course-ppts/{media_ppt_id}/stream")
    assert stream_after_del.status_code == 404, f"Stream of deleted PPT should be 404, got: {stream_after_del.status_code}"
    # Cleanup mojcc test video
    s_iadmin.post(f"{BASE_URL}/api/course-ppts/{mojcc_video_id}/delete")
    # Cleanup audio test ppt
    s_cadmin.post(f"{BASE_URL}/api/course-ppts/{audio_ppt_id}/delete")
    print("[OK] Presentation deletion cleanly removed both presentation and media file")

    # 10. Regression Checks on Existing Endpoints
    print("\n--- 10. Running Regression Checks on Core Endpoints ---")
    # Verify /api/courses
    courses_res = s_stud.get(f"{BASE_URL}/api/courses")
    assert courses_res.status_code == 200, f"/api/courses failed: {courses_res.status_code}"
    print(f"[OK] [Regression] /api/courses returned {len(courses_res.json()['data'])} courses")

    # Verify /api/sections
    sec_res = s_stud.get(f"{BASE_URL}/api/sections?course_id=2")
    assert sec_res.status_code == 200, f"/api/sections failed: {sec_res.status_code}"
    print(f"[OK] [Regression] /api/sections returned {len(sec_res.json()['data'])} sections for MOBC")

    # Verify Course Admin can add section to assigned course
    sec_add_res = s_cadmin.post(f"{BASE_URL}/api/section-add", json={"course_id": 2, "name": "Tactical Field Evaluation", "summary": "Field evaluation lecture"})
    assert sec_add_res.status_code == 200, f"Course Admin failed to add section: {sec_add_res.text}"
    print("[OK] [Regression] Course Admin added section to assigned course")

    # Verify Student CANNOT add section (403 Forbidden)
    sec_add_stud = s_stud.post(f"{BASE_URL}/api/section-add", json={"course_id": 2, "name": "Hacked Section", "summary": "Should fail"})
    assert sec_add_stud.status_code == 403, f"Student add section should be 403, got: {sec_add_stud.status_code}"
    print("[OK] [Regression] Student blocked from adding section (HTTP 403)")

    # Verify Institute Admin can fetch /api/users
    users_res = s_iadmin.get(f"{BASE_URL}/api/users")
    assert users_res.status_code == 200, f"/api/users failed: {users_res.status_code}"
    print(f"[OK] [Regression] Institute Admin fetched {len(users_res.json()['data'])} users")

    # Verify Student CANNOT fetch /api/users (403 Forbidden)
    users_stud = s_stud.get(f"{BASE_URL}/api/users")
    assert users_stud.status_code == 403, f"Student /api/users should be 403, got: {users_stud.status_code}"
    print("[OK] [Regression] Student blocked from fetching users (HTTP 403)")

    print("\n=== ALL RBAC, UPLOAD, ISOLATION, DOWNLOAD, AND REGRESSION TESTS PASSED! ===")

if __name__ == "__main__":
    run_tests()
