# 약속: 짝짓기 규칙

- 상태: 초안
- 정하는 영역: class, sync
- 쓰는 영역: class, sequence, sync
- 예시: `docs/contracts/examples/03-class-duplicate` (같은 내용의 관계 두 줄)

코드가 바뀌어 다시 해석했을 때, 이전 해석의 항목과 새 해석의 항목이 "같은 것"인지 판단하는 규칙이다. 파서는 영구 ID를 만들지 않으므로(`model-json.md` 8절) 이 문서가 그 기준을 정한다. 고정 위치(`layout-comment.md`)와 이전 배치는 이 규칙으로 짝이 맞은 항목에만 이어진다.

## 1. 클래스

| 항목 | 규칙 |
| --- | --- |
| ID | `classes[].name`(Mermaid ID). 대소문자를 구별한다. |
| 바뀌어도 같은 클래스 | `label`, `generic`, `annotations`, `namespace`, `members`, `range` |
| 바뀌면 다른 클래스 | `name` |

- `class Duck["오리"]`에서 ID는 `Duck`이다. 표시 이름 `"오리"`만 바꾸면 같은 클래스이고 위치가 유지된다.
- 이름 바꾸기를 추적하는 규칙은 두지 않는다. 옛 이름의 `@layout` 줄은 남으므로(`layout-comment.md` 4절) 이름을 되돌리면 위치도 돌아온다.

## 2. 관계

| 항목 | 규칙 |
| --- | --- |
| 묶음 키 | (`from`, `to`, `fromEnd`, `toEnd`, `line`) |
| ID | 묶음 키 + 같은 묶음 안의 순번(0부터, 코드에 나온 순서) |
| 바뀌어도 같은 관계 | `label`, `fromCardinality`, `toCardinality`, `range`, `index` |
| 바뀌면 다른 관계 | 묶음 키의 다섯 칸 중 하나 |

- `relations[].index`(전체 순번)는 ID로 쓰지 않는다. 다른 관계를 더하거나 지우면 바뀌기 때문이다.
- 지금은 연결선 경로를 저장하지 않으므로(`layout-comment.md` 3절) 관계 ID를 쓰는 곳이 없다. 경로를 저장하게 되면 이 규칙을 쓴다.

## 3. 시퀀스

| 항목 | 규칙 |
| --- | --- |
| 참여자 ID | `participants[].name` |
| 바뀌어도 같은 참여자 | `label`, `type`, `declared`, `range` |
| 바뀌면 다른 참여자 | `name` |

- 메시지는 늘 다시 계산하므로(sequence 설계 9절) 짝짓기 규칙을 두지 않는다.

## 4. 짝이 맞지 않을 때

| 경우 | 처리 |
| --- | --- |
| 새 항목 | 자동 배치 (class 설계 9절, sequence 설계 9절) |
| 사라진 항목 | 화면에서 지운다. `@layout` 줄은 지우지 않는다. |

## 5. 알려진 한계

- `model-json.md` 4절에 따라 `from`·`to`는 화살표 방향과 무관하게 코드에 적힌 순서다. 그래서 `A <|-- B`를 `B --|> A`로 고쳐 쓰면 다른 관계가 된다. 관계 ID를 쓰는 곳이 없는 지금은 영향이 없고, 연결선 경로를 저장할 때 다시 정한다.
- lollipop 관계의 자동 생성 이름(`interface0` 등)은 해석마다 같다는 보장이 없다(`model-json.md` 9절). 이런 클래스와 그 관계는 짝이 맞지 않을 수 있다.

## 6. 변경 절차

- 이 문서의 변경은 별도 PR로 하고, 쓰는 영역 담당 전원이 승인한다.
