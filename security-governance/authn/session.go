package authn

import "errors"

type Session struct {
	SubjectID string
	TenantID  string
	Roles     []string
}

func ValidateSession(s Session) error {
	if s.SubjectID == "" {
		return errors.New("subject required")
	}
	if s.TenantID == "" {
		return errors.New("tenant required")
	}
	return nil
}
